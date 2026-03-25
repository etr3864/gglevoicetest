import { prisma } from '@voice/db';
import { createLogger } from '../lib/logger';
import { createWorker } from '../lib/queue';
import { extractDispositionFromTranscript } from '../services/followup/followup.extraction';
import {
  createNewFollowup,
  advanceToNextStep,
  completeFollowup,
  optOutFollowup,
} from '../services/followup/followup.engine';
import { cancelActiveFollowup } from '../services/followup/followup.cancel';

const log = createLogger('followup-eval');

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

  const config = await prisma.followupConfig.findUnique({
    where: { agentId: call.agentId },
    include: { steps: { orderBy: { order: 'asc' } } },
  });

  if (!config?.enabled || config.steps.length === 0) return;

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
    callbackTime: Date | null;
  },
  config: {
    id: string;
    agentId: string;
    enabled: boolean;
    generalInstruction: string;
    activeHoursStart: string;
    activeHoursEnd: string;
    smartTimingEnabled: boolean;
    smartTimingMinCalls: number;
    steps: Array<{ id: string; order: number; delayMinutes: number; instruction: string }>;
  },
  existingFollowup: { id: string; currentStepOrder: number } | null,
): Promise<void> {
  const contactId = call.contactId!;

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
      if (call.direction === 'inbound') {
        await cancelActiveFollowup(contactId, call.agentId, 'appointment_booked');
      }
      return;

    case 'callback_requested':
      return handleCallback(call, config, existingFollowup);

    case 'not_interested':
      if (existingFollowup) {
        await completeFollowup(existingFollowup.id, 'not_interested');
      }
      return;

    case 'interested':
    case 'partial':
    case 'ambiguous':
    case 'no_answer':
    case 'failed':
    case 'short_call':
      return handleAdvanceOrCreate(disposition, call, config, existingFollowup);

    default:
      return handleAdvanceOrCreate(disposition, call, config, existingFollowup);
  }
}

async function handleCallback(
  call: { id: string; agentId: string; contactId: string | null; callbackTime: Date | null },
  config: {
    id: string;
    agentId: string;
    enabled: boolean;
    generalInstruction: string;
    activeHoursStart: string;
    activeHoursEnd: string;
    smartTimingEnabled: boolean;
    smartTimingMinCalls: number;
    steps: Array<{ id: string; order: number; delayMinutes: number; instruction: string }>;
  },
  existingFollowup: { id: string; currentStepOrder: number } | null,
): Promise<void> {
  if (!call.contactId || !call.callbackTime) {
    return handleAdvanceOrCreate('interested', call, config, existingFollowup);
  }

  const delayMs = call.callbackTime.getTime() - Date.now();
  const delayMinutes = Math.max(30, Math.round(delayMs / 60_000));

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

async function handleAdvanceOrCreate(
  disposition: string,
  call: { id: string; agentId: string; contactId: string | null },
  config: {
    id: string;
    agentId: string;
    enabled: boolean;
    generalInstruction: string;
    activeHoursStart: string;
    activeHoursEnd: string;
    smartTimingEnabled: boolean;
    smartTimingMinCalls: number;
    steps: Array<{ id: string; order: number; delayMinutes: number; instruction: string }>;
  },
  existingFollowup: { id: string; currentStepOrder: number } | null,
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
