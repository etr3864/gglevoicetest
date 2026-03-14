import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { reminderQueue } from '../../lib/queue';
import type { CalendarConfig, ReminderConfig, ReminderRule } from '@voice/shared';
import { TIMEZONE } from '../calendar/google';

const log = createLogger('reminder-service');

const JITTER_MS = 30_000;

interface AppointmentData {
  id: string;
  agentId: string;
  contactId: string | null;
  phone: string;
  title: string;
  description: string | null;
  startTime: Date;
  duration: number;
}

interface AgentData {
  id: string;
  name: string;
  calendarConfig: unknown;
}

export async function createRemindersForAppointment(
  appointment: AppointmentData,
  agent: AgentData,
): Promise<void> {
  const config = extractReminderConfig(agent.calendarConfig);
  if (!config?.enabled || !config.rules?.length) return;

  const contact = appointment.contactId
    ? await prisma.contact.findUnique({ where: { id: appointment.contactId } })
    : null;

  const now = Date.now();

  for (let ruleIndex = 0; ruleIndex < config.rules.length; ruleIndex++) {
    const rule = config.rules[ruleIndex];
    const scheduledFor = new Date(appointment.startTime.getTime() - rule.minutesBefore * 60_000);

    if (scheduledFor.getTime() <= now) continue;

    const resolvedContent =
      rule.contentType === 'template' && rule.template
        ? interpolateTemplate(rule.template, { appointment, contact, agentName: agent.name })
        : null;

    try {
      const reminder = await prisma.scheduledReminder.create({
        data: {
          appointmentId: appointment.id,
          agentId: agent.id,
          contactId: appointment.contactId,
          ruleIndex,
          scheduledFor,
          status: 'PENDING',
          contentType: rule.contentType,
          resolvedContent,
        },
      });

      const delay = scheduledFor.getTime() - now + Math.random() * JITTER_MS;
      const job = await reminderQueue.add(
        'call',
        { reminderId: reminder.id },
        { jobId: `reminder-${reminder.id}`, delay },
      );

      await prisma.scheduledReminder.update({
        where: { id: reminder.id },
        data: { bullmqJobId: job.id ?? null },
      });
    } catch (err) {
      log.error('Failed to create reminder', err, { appointmentId: appointment.id, ruleIndex });
    }
  }
}

export async function cancelRemindersForAppointment(appointmentId: string): Promise<void> {
  const reminders = await prisma.scheduledReminder.findMany({
    where: { appointmentId, status: 'PENDING' },
  });

  await Promise.all(
    reminders.map(async (r) => {
      if (r.bullmqJobId) {
        try { await reminderQueue.remove(r.bullmqJobId); } catch {}
      }
    }),
  );

  if (reminders.length > 0) {
    await prisma.scheduledReminder.updateMany({
      where: { id: { in: reminders.map(r => r.id) } },
      data: { status: 'CANCELLED' },
    });
  }
}

export async function rescheduleReminders(
  appointmentId: string,
  newStartTime: Date,
  agent: AgentData,
): Promise<void> {
  await cancelRemindersForAppointment(appointmentId);

  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment) return;

  await createRemindersForAppointment(
    { ...appointment, startTime: newStartTime },
    agent,
  );
}

export async function handleReminderCallEnded(
  reminderId: string,
  callStatus: string,
): Promise<void> {
  const reminder = await prisma.scheduledReminder.findUnique({
    where: { id: reminderId },
    include: { agent: true },
  });

  if (!reminder || reminder.status !== 'CALLING') return;

  if (callStatus === 'completed') {
    await prisma.scheduledReminder.update({
      where: { id: reminderId },
      data: { status: 'COMPLETED' },
    });
    return;
  }

  const config = extractReminderConfig(reminder.agent.calendarConfig);
  const maxAttempts = config?.retryAttempts ?? 2;
  const retryDelayMinutes = config?.retryDelayMinutes ?? 5;

  if (reminder.attempts < maxAttempts) {
    const newStatus = callStatus === 'no_answer' ? 'PENDING' : 'PENDING';
    const delay = retryDelayMinutes * 60_000 + Math.random() * JITTER_MS;

    await prisma.scheduledReminder.update({
      where: { id: reminderId },
      data: { status: newStatus },
    });

    const job = await reminderQueue.add(
      'call',
      { reminderId },
      { jobId: `reminder-${reminderId}-retry-${reminder.attempts}`, delay },
    );

    await prisma.scheduledReminder.update({
      where: { id: reminderId },
      data: { bullmqJobId: job.id ?? null },
    });
  } else {
    const finalStatus = callStatus === 'no_answer' ? 'NO_ANSWER' : 'FAILED';
    await prisma.scheduledReminder.update({
      where: { id: reminderId },
      data: { status: finalStatus },
    });
  }
}

export async function runSafetyScan(): Promise<void> {
  const cutoff = new Date(Date.now() - 5 * 60_000);
  const missed = await prisma.scheduledReminder.findMany({
    where: { status: 'PENDING', scheduledFor: { lt: cutoff } },
    take: 100,
  });

  for (const reminder of missed) {
    try {
      await reminderQueue.add(
        'call',
        { reminderId: reminder.id },
        { jobId: `reminder-${reminder.id}` },
      );
    } catch {}
  }

  if (missed.length > 0) {
    log.warn('Safety scan recovered reminders', { count: missed.length });
  }
}

// --- Helpers ---

function extractReminderConfig(calendarConfig: unknown): ReminderConfig | null {
  const cfg = calendarConfig as CalendarConfig | null;
  return cfg?.reminders ?? null;
}

function interpolateTemplate(
  template: string,
  ctx: { appointment: AppointmentData; contact: { name?: string | null } | null; agentName: string },
): string {
  const { appointment, contact, agentName } = ctx;
  const startTime = appointment.startTime;

  const date = startTime.toLocaleDateString('he-IL', { timeZone: TIMEZONE, day: 'numeric', month: 'long', year: 'numeric' });
  const time = startTime.toLocaleTimeString('he-IL', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' });
  const day = startTime.toLocaleDateString('he-IL', { timeZone: TIMEZONE, weekday: 'long' });

  return template
    .replace(/{customer_name}/g, contact?.name ?? appointment.phone)
    .replace(/{title}/g, appointment.title)
    .replace(/{date}/g, date)
    .replace(/{time}/g, time)
    .replace(/{day}/g, day)
    .replace(/{duration}/g, String(appointment.duration))
    .replace(/{agent_name}/g, agentName);
}
