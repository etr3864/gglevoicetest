import { prisma } from '@voice/db';
import type { BusinessHours } from '@voice/shared';
import { createLogger } from '../../lib/logger';
import { followupQueue } from '../../lib/queue';
import { redis } from '../../lib/redis';

const log = createLogger('followup-engine');

const PREFERRED_HOUR_TTL = 86_400;
const PREFERRED_JITTER_MIN = 30;
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MAX_LOOKAHEAD_DAYS = 14;

export interface FollowupConfig {
  id: string;
  agentId: string;
  enabled: boolean;
  generalInstruction: string;
  activeHoursStart: string;
  activeHoursEnd: string;
  smartTimingEnabled: boolean;
  smartTimingMinCalls: number;
  businessHours?: BusinessHours | null;
}

export interface FollowupStep {
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
    if (lastDisposition === 'callback_requested') {
      await prisma.contactFollowup.update({
        where: { id: optedOut.id },
        data: { status: 'CANCELLED' },
      });
      log.info('Re-enabled opted-out contact for explicit callback', { contactId, agentId });
    } else {
      log.info('Skipped: contact opted out', { contactId, agentId });
      return;
    }
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
  await removeOldJob(followupId);

  const scheduledFor = await calculateScheduledTime(contactId ?? '', nextStep.delayMinutes, config);

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
      attemptCount: 0,
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

const MAX_ATTEMPTS_PER_STEP = 3;

export async function rescheduleCurrentStep(
  followupId: string,
  contactId: string,
  config: FollowupConfig,
  delayMinutes: number,
  lastCallId: string,
  lastDisposition: string,
): Promise<boolean> {
  const current = await prisma.contactFollowup.findUnique({
    where: { id: followupId },
    select: { status: true, attemptCount: true, bullmqJobId: true },
  });

  if (!current || !['PENDING', 'SCHEDULED', 'EXECUTING'].includes(current.status)) return false;

  if (current.attemptCount >= MAX_ATTEMPTS_PER_STEP) return false;

  await removeOldJob(followupId, current.bullmqJobId);

  const scheduledFor = await calculateScheduledTime(contactId, delayMinutes, config);
  const delay = scheduledFor.getTime() - Date.now();

  const job = await followupQueue.add(
    'execute',
    { contactFollowupId: followupId },
    { delay: Math.max(delay, 0), jobId: `followup-${followupId}-retry-${Date.now()}` },
  );

  await prisma.contactFollowup.update({
    where: { id: followupId },
    data: {
      status: 'SCHEDULED',
      scheduledFor,
      lastCallId,
      lastDisposition,
      attemptCount: { increment: 1 },
      bullmqJobId: job.id,
    },
  });

  log.info('Rescheduled current step', {
    followupId,
    attempt: current.attemptCount + 1,
    scheduledFor: scheduledFor.toISOString(),
  });
  return true;
}

export async function completeFollowup(followupId: string, reason: string): Promise<void> {
  await removeOldJob(followupId);
  await prisma.contactFollowup.updateMany({
    where: { id: followupId, status: { in: ['PENDING', 'SCHEDULED', 'EXECUTING'] } },
    data: { status: 'COMPLETED' },
  });
  log.info('Completed followup', { followupId, reason });
}

export async function optOutFollowup(followupId: string): Promise<void> {
  await removeOldJob(followupId);
  await prisma.contactFollowup.updateMany({
    where: { id: followupId, status: { in: ['PENDING', 'SCHEDULED', 'EXECUTING'] } },
    data: { status: 'OPTED_OUT' },
  });
  log.info('Opted out followup', { followupId });
}

async function removeOldJob(followupId: string, bullmqJobId?: string | null): Promise<void> {
  const jobId = bullmqJobId ?? (
    await prisma.contactFollowup.findUnique({
      where: { id: followupId },
      select: { bullmqJobId: true },
    })
  )?.bullmqJobId;

  if (!jobId) return;
  try { await followupQueue.remove(jobId); } catch {}
}

// --- Scheduling ---

interface DayWindow {
  startMin: number;
  endMin: number;
}

interface IsraelParts {
  dayName: string;
  totalMin: number;
  offsetMs: number;
  midnightUtcMs: number;
}

export async function calculateScheduledTime(
  contactId: string,
  delayMinutes: number,
  config: FollowupConfig,
): Promise<Date> {
  const preferredHour = contactId
    ? await getPreferredHour(contactId, config.smartTimingEnabled, config.smartTimingMinCalls)
    : null;

  const rawTime = new Date(Date.now() + delayMinutes * 60_000);
  return scheduleInBusinessHours(rawTime, delayMinutes, preferredHour, config);
}

function scheduleInBusinessHours(
  rawTime: Date,
  delayMinutes: number,
  preferredHour: number | null,
  config: FollowupConfig,
): Date {
  const israel = toIsraelParts(rawTime);
  const dayHours = resolveDayHours(israel.dayName, config);

  if (dayHours && israel.totalMin >= dayHours.startMin && israel.totalMin < dayHours.endMin) {
    return applyPreferredHour(rawTime, israel, preferredHour, dayHours);
  }

  const next = findNextBusinessDay(rawTime, config);
  if (!next) return rawTime;

  if (preferredHour !== null) {
    const targetMin = preferredHour * 60;
    if (targetMin >= next.hours.startMin && targetMin < next.hours.endMin) {
      const jitter = Math.round((Math.random() - 0.5) * 2 * PREFERRED_JITTER_MIN);
      const clamped = clamp(targetMin + jitter, next.hours.startMin, next.hours.endMin - 1);
      return israelMinToUtc(next.midnightUtcMs, clamped, next.offsetMs);
    }
  }

  const withDelay = clamp(next.hours.startMin + delayMinutes, next.hours.startMin, next.hours.endMin - 1);
  return israelMinToUtc(next.midnightUtcMs, withDelay, next.offsetMs);
}

function applyPreferredHour(
  rawTime: Date,
  israel: IsraelParts,
  preferredHour: number | null,
  dayHours: DayWindow,
): Date {
  if (preferredHour === null) return rawTime;
  const targetMin = preferredHour * 60;
  if (targetMin <= israel.totalMin || targetMin < dayHours.startMin || targetMin >= dayHours.endMin) return rawTime;

  const jitter = Math.round((Math.random() - 0.5) * 2 * PREFERRED_JITTER_MIN);
  const clamped = clamp(targetMin + jitter, dayHours.startMin, dayHours.endMin - 1);
  return israelMinToUtc(israel.midnightUtcMs, clamped, israel.offsetMs);
}

function resolveDayHours(dayName: string, config: FollowupConfig): DayWindow | null {
  if (config.businessHours) {
    const slot = config.businessHours[dayName];
    if (!slot) return null;
    return parseWindow(slot.start, slot.end);
  }
  return parseWindow(config.activeHoursStart, config.activeHoursEnd);
}

function parseWindow(start: string, end: string): DayWindow {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return { startMin: sh * 60 + sm, endMin: eh * 60 + em };
}

interface NextDay {
  midnightUtcMs: number;
  offsetMs: number;
  hours: DayWindow;
}

function findNextBusinessDay(from: Date, config: FollowupConfig): NextDay | null {
  for (let i = 1; i <= MAX_LOOKAHEAD_DAYS; i++) {
    const candidate = new Date(from.getTime() + i * 86_400_000);
    const parts = toIsraelParts(candidate);
    const hours = resolveDayHours(parts.dayName, config);
    if (hours) return { midnightUtcMs: parts.midnightUtcMs, offsetMs: parts.offsetMs, hours };
  }
  return null;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function israelMinToUtc(midnightUtcMs: number, minutesSinceMidnight: number, offsetMs: number): Date {
  return new Date(midnightUtcMs + minutesSinceMidnight * 60_000 - offsetMs);
}

function toIsraelParts(date: Date): IsraelParts {
  const offsetMs = getIsraelOffsetMs(date);
  const israelMs = date.getTime() + offsetMs;
  const israelDate = new Date(israelMs);
  const dayName = DAY_NAMES[israelDate.getUTCDay()];
  const totalMin = israelDate.getUTCHours() * 60 + israelDate.getUTCMinutes();
  const midnightUtcMs = Date.UTC(israelDate.getUTCFullYear(), israelDate.getUTCMonth(), israelDate.getUTCDate());
  return { dayName, totalMin, offsetMs, midnightUtcMs };
}

function getIsraelOffsetMs(date: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0');
  const israelDate = new Date(Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')));
  return israelDate.getTime() - date.getTime();
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
