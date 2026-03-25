import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { followupQueue } from '../../lib/queue';
import { redis } from '../../lib/redis';

const log = createLogger('followup-engine');

const JITTER_MAX_MS = 5 * 60_000;
const PREFERRED_HOUR_TTL = 86_400;
const PREFERRED_HOUR_MIN_CALLS = 3;

interface FollowupConfig {
  id: string;
  agentId: string;
  enabled: boolean;
  generalInstruction: string;
  activeHoursStart: string;
  activeHoursEnd: string;
  smartTimingEnabled: boolean;
  smartTimingMinCalls: number;
}

interface FollowupStep {
  id: string;
  order: number;
  delayMinutes: number;
  instruction: string;
}

export async function createNewFollowup(
  contactId: string,
  agentId: string,
  firstStep: FollowupStep,
  config: FollowupConfig,
  lastCallId: string,
  lastDisposition: string,
): Promise<void> {
  const optedOut = await prisma.contactFollowup.findFirst({
    where: { contactId, agentId, status: 'OPTED_OUT' },
  });
  if (optedOut) {
    log.info('Skipped: contact opted out', { contactId, agentId });
    return;
  }

  const scheduledFor = await calculateScheduledTime(contactId, firstStep.delayMinutes, config);

  try {
    const followup = await prisma.contactFollowup.create({
      data: {
        contactId,
        agentId,
        currentStepOrder: firstStep.order,
        status: 'SCHEDULED',
        lastDisposition: lastDisposition,
        lastCallId: lastCallId,
        scheduledFor,
        stepDelayMinutes: firstStep.delayMinutes,
        stepInstruction: firstStep.instruction,
      },
    });

    const delay = scheduledFor.getTime() - Date.now();
    const job = await followupQueue.add(
      'execute',
      { contactFollowupId: followup.id },
      { delay: Math.max(delay, 0), jobId: `followup-${followup.id}` },
    );

    await prisma.contactFollowup.update({
      where: { id: followup.id },
      data: { bullmqJobId: job.id },
    });

    log.info('Created followup', { followupId: followup.id, contactId, agentId, scheduledFor: scheduledFor.toISOString() });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      log.info('Duplicate followup skipped (partial unique index)', { contactId, agentId });
      return;
    }
    throw err;
  }
}

export async function advanceToNextStep(
  followupId: string,
  currentStepOrder: number,
  nextStep: FollowupStep,
  config: FollowupConfig,
  lastCallId: string,
  lastDisposition: string,
  contactId?: string,
): Promise<void> {
  const scheduledFor = await calculateScheduledTime(
    contactId ?? '',
    nextStep.delayMinutes,
    config,
  );

  const result = await prisma.contactFollowup.updateMany({
    where: {
      id: followupId,
      currentStepOrder,
      status: { in: ['PENDING', 'SCHEDULED', 'EXECUTING'] },
    },
    data: {
      currentStepOrder: nextStep.order,
      status: 'SCHEDULED',
      lastDisposition: lastDisposition,
      lastCallId: lastCallId,
      scheduledFor,
      stepDelayMinutes: nextStep.delayMinutes,
      stepInstruction: nextStep.instruction,
    },
  });

  if (result.count === 0) {
    log.warn('advanceToNextStep: optimistic lock failed', { followupId, currentStepOrder });
    return;
  }

  const delay = scheduledFor.getTime() - Date.now();
  const job = await followupQueue.add(
    'execute',
    { contactFollowupId: followupId },
    { delay: Math.max(delay, 0), jobId: `followup-${followupId}-step-${nextStep.order}` },
  );

  await prisma.contactFollowup.update({
    where: { id: followupId },
    data: { bullmqJobId: job.id },
  });

  log.info('Advanced followup', { followupId, step: nextStep.order, scheduledFor: scheduledFor.toISOString() });
}

export async function completeFollowup(followupId: string, reason: string): Promise<void> {
  await prisma.contactFollowup.updateMany({
    where: { id: followupId, status: { in: ['PENDING', 'SCHEDULED', 'EXECUTING'] } },
    data: { status: 'COMPLETED' },
  });
  log.info('Completed followup', { followupId, reason });
}

export async function optOutFollowup(followupId: string): Promise<void> {
  await prisma.contactFollowup.updateMany({
    where: { id: followupId, status: { in: ['PENDING', 'SCHEDULED', 'EXECUTING'] } },
    data: { status: 'OPTED_OUT' },
  });
  log.info('Opted out followup', { followupId });
}

export async function calculateScheduledTime(
  contactId: string,
  delayMinutes: number,
  config: FollowupConfig,
): Promise<Date> {
  const baseTime = new Date(Date.now() + delayMinutes * 60_000);
  const jitter = Math.floor(Math.random() * JITTER_MAX_MS);
  const withJitter = new Date(baseTime.getTime() + jitter);

  const preferredHour = contactId
    ? await getPreferredHour(contactId, config.smartTimingEnabled, config.smartTimingMinCalls)
    : null;

  return adjustToActiveHours(withJitter, config.activeHoursStart, config.activeHoursEnd, preferredHour);
}

async function getPreferredHour(
  contactId: string,
  smartTimingEnabled: boolean,
  minCalls: number,
): Promise<number | null> {
  if (!smartTimingEnabled) return null;

  const cacheKey = `preferred-hour:${contactId}`;
  const cached = await redis.get(cacheKey);
  if (cached !== null) return parseInt(cached, 10);

  const result = await prisma.$queryRaw<Array<{ hour: number; count: bigint }>>`
    SELECT EXTRACT(HOUR FROM "started_at" AT TIME ZONE 'Asia/Jerusalem')::int as hour,
           COUNT(*) as count
    FROM (
      SELECT "started_at" FROM "calls"
      WHERE "contact_id" = ${contactId}
        AND "status" = 'completed'
        AND "duration_sec" > 30
      ORDER BY "started_at" DESC
      LIMIT 20
    ) recent
    GROUP BY hour
    ORDER BY count DESC
    LIMIT 1
  `;

  if (!result.length || Number(result[0].count) < minCalls) return null;

  const hour = result[0].hour;
  await redis.set(cacheKey, String(hour), 'EX', PREFERRED_HOUR_TTL);
  return hour;
}

function adjustToActiveHours(
  date: Date,
  activeStart: string,
  activeEnd: string,
  preferredHour: number | null,
): Date {
  const [startH, startM] = activeStart.split(':').map(Number);
  const [endH, endM] = activeEnd.split(':').map(Number);
  const startTotalMin = startH * 60 + startM;
  const endTotalMin = endH * 60 + endM;

  const israelFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    hour: 'numeric', minute: 'numeric', hour12: false,
    year: 'numeric', month: 'numeric', day: 'numeric',
  });
  const parts = israelFormatter.formatToParts(date);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0');
  const currentHour = get('hour');
  const currentMin = get('minute');
  const currentTotalMin = currentHour * 60 + currentMin;

  if (currentTotalMin >= startTotalMin && currentTotalMin < endTotalMin) {
    if (preferredHour !== null && preferredHour >= startH && preferredHour < endH) {
      const diff = (preferredHour - currentHour) * 60 - currentMin;
      if (diff > 0) return new Date(date.getTime() + diff * 60_000);
    }
    return date;
  }

  const offsetMs = getIsraelOffsetMs(date);
  const israelMidnight = new Date(date.getTime() + offsetMs);
  israelMidnight.setUTCHours(0, 0, 0, 0);

  if (currentTotalMin >= endTotalMin) {
    israelMidnight.setUTCDate(israelMidnight.getUTCDate() + 1);
  }

  const targetHour = preferredHour !== null && preferredHour >= startH && preferredHour < endH
    ? preferredHour
    : startH;
  const targetMin = targetHour === startH ? startM : 0;

  const targetIsraelMs = israelMidnight.getTime() + (targetHour * 60 + targetMin) * 60_000;
  return new Date(targetIsraelMs - offsetMs);
}

function getIsraelOffsetMs(date: Date): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const israelStr = date.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' });
  return new Date(israelStr).getTime() - new Date(utcStr).getTime();
}
