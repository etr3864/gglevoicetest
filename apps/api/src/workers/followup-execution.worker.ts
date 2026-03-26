import { prisma } from '@voice/db';
import { createLogger } from '../lib/logger';
import { createWorker, outboundQueue, OUTBOUND_PRIORITY } from '../lib/queue';
import { normalizePhone } from '../lib/phone';
import { publishCallEvent } from '../services/events/pubsub';

const log = createLogger('followup-exec');

interface FollowupExecJob {
  contactFollowupId: string;
}

export function startFollowupExecutionWorker() {
  const worker = createWorker<FollowupExecJob>(
    'followup-calls',
    async (job) => {
      await executeFollowup(job.data.contactFollowupId);
    },
    { concurrency: 5 },
  );

  worker.on('failed', (job, err) => {
    log.error('Followup execution failed', undefined, {
      jobId: job?.id,
      contactFollowupId: job?.data.contactFollowupId,
      reason: err?.message?.slice(0, 150),
    });
  });

  return worker;
}

async function executeFollowup(contactFollowupId: string): Promise<void> {
  const followup = await prisma.contactFollowup.findUnique({
    where: { id: contactFollowupId },
    include: {
      contact: true,
      agent: true,
    },
  });

  if (!followup) {
    log.warn('Followup not found', { contactFollowupId });
    return;
  }

  if (followup.status !== 'SCHEDULED') {
    log.info('Followup no longer scheduled', { contactFollowupId, status: followup.status });
    return;
  }

  if (followup.agent.status === 'inactive') {
    log.info('Agent inactive, skipping followup', { contactFollowupId, agentId: followup.agentId });
    return;
  }

  const config = await prisma.followupConfig.findUnique({
    where: { agentId: followup.agentId },
    select: {
      enabled: true,
      generalInstruction: true,
      callbackOpeningMessage: true,
    },
  });

  if (!config?.enabled) {
    log.info('Followup config disabled', { contactFollowupId, agentId: followup.agentId });
    return;
  }

  const hasOptedOut = await prisma.contactFollowup.findFirst({
    where: { contactId: followup.contactId, agentId: followup.agentId, status: 'OPTED_OUT' },
  });
  if (hasOptedOut) {
    await prisma.contactFollowup.update({
      where: { id: contactFollowupId },
      data: { status: 'CANCELLED' },
    });
    return;
  }

  await prisma.contactFollowup.update({
    where: { id: contactFollowupId },
    data: { status: 'EXECUTING' },
  });

  const phone = normalizePhone(followup.contact.phone);

  try {
    const call = await prisma.call.create({
      data: {
        agentId: followup.agentId,
        contactId: followup.contactId,
        direction: 'outbound',
        callType: 'followup',
        status: 'queued',
        startedAt: new Date(),
      },
    });

    await prisma.contactFollowup.update({
      where: { id: contactFollowupId },
      data: { lastCallId: call.id },
    });

    await publishCallEvent(followup.agentId, 'call_created', { call });

    const step = await prisma.followupStep.findFirst({
      where: { followupConfig: { agentId: followup.agentId }, order: followup.currentStepOrder },
      select: { openingMessage: true },
    });

    const callContext = buildFollowupCallContext(followup, config, step?.openingMessage ?? null);

    const delay = Math.round(Math.random() * 15_000);
    await outboundQueue.add(
      'dial',
      {
        callId: call.id,
        agentId: followup.agentId,
        contactId: followup.contactId,
        phone,
        context: callContext,
        type: 'followup',
        contactFollowupId,
      },
      { attempts: 1, delay, priority: OUTBOUND_PRIORITY.followup },
    );
  } catch (err) {
    log.error('Failed to launch followup call', err, { contactFollowupId });
    await prisma.contactFollowup.update({
      where: { id: contactFollowupId },
      data: { status: 'SCHEDULED' },
    });
    throw err;
  }
}

function buildFollowupCallContext(
  followup: {
    id: string;
    stepInstruction: string | null;
    lastDisposition: string | null;
    currentStepOrder: number;
  },
  config: {
    generalInstruction: string;
    callbackOpeningMessage: string | null;
  },
  stepOpeningMessage: string | null,
): Record<string, unknown> {
  const openingMessage = resolveOpeningMessage(
    followup.lastDisposition,
    config.callbackOpeningMessage,
    stepOpeningMessage,
  );

  return {
    callType: 'followup',
    contactFollowupId: followup.id,
    __followupGeneralInstruction: config.generalInstruction || undefined,
    __followupStepInstruction: followup.stepInstruction || undefined,
    __followupStep: followup.currentStepOrder,
    __followupLastDisposition: followup.lastDisposition || undefined,
    __openingMessage: openingMessage,
  };
}

function resolveOpeningMessage(
  lastDisposition: string | null,
  callbackOpeningMessage: string | null,
  stepOpeningMessage: string | null,
): string | undefined {
  if (lastDisposition === 'callback_requested' && callbackOpeningMessage) {
    return callbackOpeningMessage;
  }
  return stepOpeningMessage ?? undefined;
}
