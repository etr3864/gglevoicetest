import { prisma } from '@voice/db';
import { createLogger } from '../lib/logger';
import { createWorker } from '../lib/queue';
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
      durationSec: true,
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

  if (!rawConfig?.enabled || rawConfig.steps.length === 0) return;

  const config = { ...rawConfig, businessHours: agent?.businessHours as Record<string, { start: string; end: string } | null> | null };

  let disposition = call.disposition;

  if (!disposition && call.status === 'completed' && (call.durationSec ?? 0) >= 15) {
    disposition = await resolveDispositionFromTranscript(callId);
    await prisma.call.update({
      where: { id: callId },
      data: { disposition },
    });
  }

  disposition = disposition ?? call.status;

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

async function resolveDispositionFromTranscript(callId: string): Promise<string> {
  const utterances = await prisma.utterance.findMany({
    where: { callId },
    orderBy: { startMs: 'asc' },
    take: 50,
  });

  if (utterances.length === 0) return 'short_call';

  const transcript = utterances
    .map((u) => `${u.speaker}: ${u.text}`)
    .join('\n');

  return extractDispositionFromTranscript(transcript);
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
    case 'ambiguous':
      return handleAdvanceOrCreate(disposition, call, config, existingFollowup);

    default:
      return handleAdvanceOrCreate(disposition, call, config, existingFollowup);
  }
}

async function handleCallback(
  call: { id: string; agentId: string; contactId: string | null; callType: string | null; callbackTime: Date | null },
  config: FollowupEvalConfig,
  existingFollowup: ExistingFollowup | null,
): Promise<void> {
  if (!call.contactId || !call.callbackTime) {
    return handleAdvanceOrCreate('interested', call, config, existingFollowup);
  }

  const delayMs = call.callbackTime.getTime() - Date.now();
  const delayMinutes = Math.max(config.minCallbackMinutes, Math.round(delayMs / 60_000));

  const nextStep = existingFollowup
    ? getNextStep(config.steps, existingFollowup.currentStepOrder)
    : config.steps[0];

  if (!nextStep) {
    if (existingFollowup) {
      await completeFollowup(existingFollowup.id, 'callback_no_more_steps');
    }
    return;
  }

  const callbackStep = { ...nextStep, delayMinutes };

  if (existingFollowup) {
    await advanceToNextStep(
      existingFollowup.id,
      existingFollowup.currentStepOrder,
      callbackStep,
      config,
      call.id,
      'callback_requested',
      call.contactId ?? undefined,
    );
  } else {
    await createNewFollowup(call.contactId, call.agentId, callbackStep, config, call.id, 'callback_requested');
  }
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
