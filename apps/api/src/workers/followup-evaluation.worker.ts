import { prisma } from '@voice/db';
import { createLogger } from '../lib/logger';
import { createWorker, followupQueue } from '../lib/queue';
import { extractDispositionFromTranscript } from '../services/followup/followup.extraction';
import {
  createNewFollowup,
  advanceToNextStep,
  completeFollowup,
  optOutFollowup,
  rescheduleCurrentStep,
} from '../services/followup/followup.engine';

const log = createLogger('followup-eval');

interface ExistingFollowup {
  id: string;
  currentStepOrder: number;
  attemptCount: number;
  stepDelayMinutes: number | null;
}

interface FollowupEvalConfig {
  id: string;
  agentId: string;
  enabled: boolean;
  generalInstruction: string;
  activeHoursStart: string;
  activeHoursEnd: string;
  smartTimingEnabled: boolean;
  smartTimingMinCalls: number;
  minCallbackMinutes: number;
  steps: Array<{ id: string; order: number; delayMinutes: number; instruction: string }>;
  businessHours?: Record<string, { start: string; end: string } | null> | null;
}

interface EvalJob {
  callId: string;
}

export function startFollowupEvaluationWorker() {
  const worker = createWorker<EvalJob>(
    'followup-evaluation',
    async (job) => {
      await evaluateCall(job.data.callId);
    },
    { concurrency: 10 },
  );

  worker.on('failed', (job, err) => {
    log.error('Evaluation job failed', undefined, {
      jobId: job?.id,
      callId: job?.data.callId,
      reason: err?.message?.slice(0, 150),
    });
  });

  return worker;
}

async function evaluateCall(callId: string): Promise<void> {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    select: {
      id: true,
      agentId: true,
      contactId: true,
      direction: true,
      callType: true,
      status: true,
      disposition: true,
      callbackTime: true,
    },
  });

  if (!call || !call.contactId) return;

  const [rawConfig, agent] = await Promise.all([
    prisma.followupConfig.findUnique({
      where: { agentId: call.agentId },
      include: { steps: { orderBy: { order: 'asc' } } },
    }),
    prisma.agent.findUnique({
      where: { id: call.agentId },
      select: { businessHours: true },
    }),
  ]);

  if (!rawConfig?.enabled) return;

  const config = { ...rawConfig, businessHours: agent?.businessHours as Record<string, { start: string; end: string } | null> | null };

  let disposition = call.disposition;

  if (!disposition && call.status === 'completed') {
    disposition = await resolveDispositionFromTranscript(callId, config.generalInstruction);
    await prisma.call.update({ where: { id: callId }, data: { disposition } });
  }

  disposition = disposition ?? call.status;

  if (call.direction === 'inbound' && disposition !== 'callback_requested') return;

  const existingFollowup = await prisma.contactFollowup.findFirst({
    where: {
      contactId: call.contactId,
      agentId: call.agentId,
      status: { in: ['PENDING', 'SCHEDULED', 'EXECUTING'] },
    },
    select: { id: true, currentStepOrder: true, attemptCount: true, stepDelayMinutes: true },
  });

  await applyDispositionRules(disposition, call, config, existingFollowup);
}

async function resolveDispositionFromTranscript(callId: string, generalInstruction: string): Promise<string> {
  const utterances = await prisma.utterance.findMany({
    where: { callId },
    orderBy: { startMs: 'asc' },
    take: 50,
  });

  const hasCustomerSpeech = utterances.some((u) => u.speaker === 'customer');
  if (!hasCustomerSpeech) return 'short_call';

  const transcript = utterances.map((u) => `${u.speaker}: ${u.text}`).join('\n');
  return extractDispositionFromTranscript(transcript, generalInstruction);
}

async function applyDispositionRules(
  disposition: string,
  call: {
    id: string;
    agentId: string;
    contactId: string | null;
    direction: string;
    callType: string | null;
    callbackTime: Date | null;
  },
  config: FollowupEvalConfig,
  existingFollowup: ExistingFollowup | null,
): Promise<void> {
  switch (disposition) {
    case 'do_not_call':
      if (existingFollowup) {
        await optOutFollowup(existingFollowup.id);
      }
      return;

    case 'appointment_booked':
      if (existingFollowup) {
        await completeFollowup(existingFollowup.id, 'appointment_booked');
      }
      return;

    case 'callback_requested':
      return handleCallback(call, config, existingFollowup);

    case 'not_interested':
      if (existingFollowup) {
        await completeFollowup(existingFollowup.id, 'not_interested');
      }
      return;

    case 'no_answer':
    case 'failed':
    case 'short_call':
      return handleRetryOrAdvance(disposition, call, config, existingFollowup);

    case 'interested':
    case 'partial':
      return handleAdvanceOrCreate(disposition, call, config, existingFollowup);

    case 'ambiguous':
    default:
      if (existingFollowup) {
        return handleAdvanceOrCreate(disposition, call, config, existingFollowup);
      }
      return;
  }
}

async function handleCallback(
  call: { id: string; agentId: string; contactId: string | null; direction: string; callType: string | null; callbackTime: Date | null },
  config: FollowupEvalConfig,
  existingFollowup: ExistingFollowup | null,
): Promise<void> {
  if (!call.contactId) return;

  if (call.direction === 'inbound') {
    return scheduleInboundCallback(call.contactId, call.agentId, call.callbackTime, config);
  }

  if (!call.callbackTime) {
    return handleAdvanceOrCreate('interested', call, config, existingFollowup);
  }

  const minDelayMs = config.minCallbackMinutes * 60_000;
  const earliest = new Date(Date.now() + minDelayMs);
  const scheduledFor = call.callbackTime > earliest ? call.callbackTime : earliest;

  const nextStep = existingFollowup
    ? getNextStep(config.steps, existingFollowup.currentStepOrder)
    : config.steps[0];

  // No steps configured — use the direct callback path (same as inbound)
  if (!nextStep) {
    if (existingFollowup) {
      await completeFollowup(existingFollowup.id, 'callback_no_more_steps');
    }
    return scheduleInboundCallback(call.contactId, call.agentId, call.callbackTime, config);
  }

  const callbackStep = { ...nextStep, delayMinutes: 0 };

  if (existingFollowup) {
    await advanceToNextStep(
      existingFollowup.id,
      existingFollowup.currentStepOrder,
      callbackStep,
      config,
      call.id,
      'callback_requested',
      call.contactId ?? undefined,
      scheduledFor,
    );
  } else {
    await createNewFollowup(call.contactId, call.agentId, callbackStep, config, call.id, 'callback_requested', scheduledFor);
  }
}

async function scheduleInboundCallback(
  contactId: string,
  agentId: string,
  callbackTime: Date | null,
  config: FollowupEvalConfig,
): Promise<void> {
  const minDelayMs = config.minCallbackMinutes * 60_000;
  const earliest = new Date(Date.now() + minDelayMs);
  const scheduledFor = callbackTime && callbackTime > earliest ? callbackTime : earliest;
  const delay = Math.max(scheduledFor.getTime() - Date.now(), 0);

  const existingActive = await prisma.contactFollowup.findFirst({
    where: { contactId, agentId, status: { in: ['PENDING', 'SCHEDULED'] } },
    select: { id: true, bullmqJobId: true },
  });

  if (existingActive) {
    if (existingActive.bullmqJobId) {
      try { await followupQueue.remove(existingActive.bullmqJobId); } catch {}
    }
    await prisma.contactFollowup.update({
      where: { id: existingActive.id },
      data: { status: 'CANCELLED' },
    });
  }

  const followup = await prisma.contactFollowup.create({
    data: {
      contactId,
      agentId,
      currentStepOrder: 0,
      status: 'SCHEDULED',
      lastDisposition: 'callback_requested',
      isCustomerCallback: true,
      scheduledFor,
    },
  });

  const job = await followupQueue.add(
    'execute',
    { contactFollowupId: followup.id },
    { delay, jobId: `followup-${followup.id}` },
  );

  await prisma.contactFollowup.update({
    where: { id: followup.id },
    data: { bullmqJobId: job.id },
  });

  log.info('Scheduled inbound callback', { followupId: followup.id, agentId, scheduledFor });
}

async function handleRetryOrAdvance(
  disposition: string,
  call: { id: string; agentId: string; contactId: string | null; callType: string | null },
  config: FollowupEvalConfig,
  existingFollowup: ExistingFollowup | null,
): Promise<void> {
  if (!call.contactId) return;

  if (existingFollowup) {
    const rescheduled = await rescheduleCurrentStep(
      existingFollowup.id,
      call.contactId,
      config,
      existingFollowup.stepDelayMinutes ?? config.steps[0]?.delayMinutes ?? 60,
      call.id,
      disposition,
    );
    if (!rescheduled) {
      await handleAdvanceOrCreate(disposition, call, config, existingFollowup);
    }
    return;
  }

  if (call.callType === 'followup') return;
  const firstStep = config.steps[0];
  if (!firstStep) return;
  await createNewFollowup(call.contactId, call.agentId, firstStep, config, call.id, disposition);
}

async function handleAdvanceOrCreate(
  disposition: string,
  call: { id: string; agentId: string; contactId: string | null; callType: string | null },
  config: FollowupEvalConfig,
  existingFollowup: ExistingFollowup | null,
): Promise<void> {
  if (!call.contactId) return;

  if (existingFollowup) {
    const nextStep = getNextStep(config.steps, existingFollowup.currentStepOrder);
    if (!nextStep) {
      await completeFollowup(existingFollowup.id, 'all_steps_done');
      return;
    }
    await advanceToNextStep(
      existingFollowup.id,
      existingFollowup.currentStepOrder,
      nextStep,
      config,
      call.id,
      disposition,
      call.contactId ?? undefined,
    );
  } else {
    if (call.callType === 'followup') return;
    const firstStep = config.steps[0];
    if (!firstStep) return;
    await createNewFollowup(call.contactId, call.agentId, firstStep, config, call.id, disposition);
  }
}

function getNextStep(
  steps: Array<{ order: number; id: string; delayMinutes: number; instruction: string }>,
  currentOrder: number,
): typeof steps[number] | undefined {
  return steps.find((s) => s.order > currentOrder);
}
