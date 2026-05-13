import { prisma } from '@voice/db';
import { createLogger } from '../lib/logger';
import { createWorker, outboundQueue, scheduleReminderSafetyScan, OUTBOUND_PRIORITY } from '../lib/queue';
import { runSafetyScan } from '../services/reminders/reminder.service';
import { normalizePhone } from '../lib/phone';
import { publishCallEvent } from '../services/events/pubsub';
import { formatNow, describeRelativeDateTime } from '../lib/date';

const log = createLogger('reminder-worker');

// Used for template mode: opening message already contains the reminder text,
// so the system prompt must NOT instruct Gemini to deliver it again.
const DIRECTION_TEMPLATE_REMINDER = '\n\n--- Direction ---\nThis is an outbound reminder call. You have already delivered your reminder message as the opening. Now listen to the customer\'s response and handle any follow-up questions naturally. Do not repeat the reminder unless asked.';

// Used for AI mode: no opening message — Gemini delivers the reminder from context.
const DIRECTION_AI_REMINDER = '\n\n--- Direction ---\nThis is an outbound reminder call. Deliver the appointment reminder in a warm, friendly, and natural tone — as if you are a helpful assistant calling a client. Be concise and conversational. After delivering the reminder, listen and handle any questions or requests.';

interface ReminderJob {
  reminderId: string;
}

export function startReminderWorker() {
  const worker = createWorker<ReminderJob | Record<string, never>>(
    'reminder-calls',
    async (job) => {
      if (job.name === 'safety-scan') {
        await runSafetyScan();
        return;
      }
      await executeReminder((job.data as ReminderJob).reminderId);
    },
    { concurrency: 5 },
  );

  worker.on('failed', (job, err) => {
    log.error('Reminder job failed', undefined, { jobId: job?.id, reason: err?.message?.slice(0, 150) });
  });

  scheduleReminderSafetyScan().catch((err) => {
    log.error('Failed to schedule safety scan', err);
  });

  return worker;
}

async function executeReminder(reminderId: string): Promise<void> {
  const reminder = await prisma.scheduledReminder.findUnique({
    where: { id: reminderId },
    include: { appointment: true, agent: true, contact: true },
  });

  if (!reminder) {
    log.warn('Reminder not found', { reminderId });
    return;
  }

  if (reminder.status !== 'PENDING') {
    log.info('Reminder already processed', { reminderId, status: reminder.status });
    return;
  }

  if (reminder.appointment.status !== 'scheduled') {
    await prisma.scheduledReminder.update({
      where: { id: reminderId },
      data: { status: 'CANCELLED' },
    });
    return;
  }

  await prisma.scheduledReminder.update({
    where: { id: reminderId },
    data: { status: 'CALLING', attempts: { increment: 1 }, lastAttemptAt: new Date() },
  });

  const callContext = buildCallContext(reminder);
  const phone = normalizePhone(reminder.appointment.phone);

  try {
    const call = await prisma.call.create({
      data: {
        agentId: reminder.agentId,
        contactId: reminder.contactId,
        direction: 'outbound',
        callType: 'reminder',
        status: 'queued',
        startedAt: new Date(),
      },
    });

    await prisma.scheduledReminder.update({
      where: { id: reminderId },
      data: { callId: call.id },
    });

    await publishCallEvent(reminder.agentId, 'call_created', { call });
    await publishCallEvent(reminder.agentId, 'reminder_updated', {});

    const delay = Math.round(Math.random() * 30_000);
    await outboundQueue.add(
      'dial',
      { callId: call.id, agentId: reminder.agentId, phone, context: callContext },
      { attempts: 1, delay, priority: OUTBOUND_PRIORITY.reminder },
    );
  } catch (err) {
    log.error('Failed to launch reminder call', err, { reminderId });
    await prisma.scheduledReminder.update({
      where: { id: reminderId },
      data: { status: 'PENDING', lastError: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

function buildCallContext(reminder: {
  id: string;
  contentType: string;
  resolvedContent: string | null;
  agent: { name: string; basePrompt: string | null };
  appointment: { title: string; startTime: Date; duration: number; description: string | null };
  contact: { name: string | null } | null;
}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    callType: 'reminder',
    reminderId: reminder.id,
  };

  if (reminder.contentType === 'template' && reminder.resolvedContent) {
    const agentBase = reminder.agent.basePrompt || 'You are a helpful voice assistant.';
    base.__systemPrompt = agentBase + DIRECTION_TEMPLATE_REMINDER;
    base.__openingMessage = reminder.resolvedContent;
  } else {
    base.__systemPrompt = buildAiReminderPrompt(reminder);
  }

  return base;
}

function buildAiReminderPrompt(reminder: {
  agent: { name: string; basePrompt: string | null };
  appointment: { title: string; startTime: Date; duration: number; description: string | null };
  contact: { name: string | null } | null;
}): string {
  const { appointment, contact, agent } = reminder;
  const when = describeRelativeDateTime(appointment.startTime);

  const base = agent.basePrompt || 'You are a helpful voice assistant.';

  return `${base}${DIRECTION_AI_REMINDER}

--- Reminder Details ---
Current date and time: ${formatNow()}
Customer: ${contact?.name ?? 'the customer'}
Appointment: ${appointment.title}
When: ${when}
Duration: ${appointment.duration} minutes
${appointment.description ? `Notes: ${appointment.description}` : ''}

IMPORTANT: Use the "When" field above exactly as given. Do not recompute the date — if it says TODAY, say today; if TOMORROW, say tomorrow.`.trim();
}
