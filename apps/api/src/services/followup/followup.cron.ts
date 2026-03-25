import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { redis } from '../../lib/redis';
import { followupEvalQueue, followupQueue } from '../../lib/queue';

const log = createLogger('followup-cron');

const SCAN_INTERVAL_MS = 15 * 60_000;
const LOCK_KEY = 'followup-cron-lock';
const LOCK_TTL_SEC = 300;
const SCAN_LIMIT = 50;

export function startFollowupCrons(): void {
  setInterval(runWithLock, SCAN_INTERVAL_MS);
}

async function runWithLock(): Promise<void> {
  const acquired = await redis.set(LOCK_KEY, '1', 'EX', LOCK_TTL_SEC, 'NX');
  if (!acquired) return;

  try {
    await scanMissedEvaluations();
    await scanStaleScheduled();
    await scanStaleExecuting();
    await scanStalePending();
  } catch (err) {
    log.error('Followup safety net error', err);
  }
}

async function scanMissedEvaluations(): Promise<void> {
  const cutoff = new Date(Date.now() - 10 * 60_000);

  const calls = await prisma.call.findMany({
    where: {
      callType: 'followup',
      status: { in: ['completed', 'failed', 'no_answer'] },
      disposition: null,
      endedAt: { lte: cutoff },
    },
    take: SCAN_LIMIT,
    select: { id: true },
  });

  for (const call of calls) {
    await followupEvalQueue.add('evaluate', { callId: call.id }, {
      jobId: `followup-eval-recovery-${call.id}`,
    });
  }

  if (calls.length > 0) {
    log.info('Recovered missed evaluations', { count: calls.length });
  }
}

async function scanStaleScheduled(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 60_000);

  const stale = await prisma.contactFollowup.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledFor: { lte: cutoff },
    },
    take: SCAN_LIMIT,
    select: { id: true },
  });

  for (const followup of stale) {
    await followupQueue.add(
      'execute',
      { contactFollowupId: followup.id },
      { jobId: `followup-recovery-${followup.id}` },
    );
  }

  if (stale.length > 0) {
    log.info('Recovered stale SCHEDULED followups', { count: stale.length });
  }
}

async function scanStaleExecuting(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 60_000);

  const stale = await prisma.contactFollowup.findMany({
    where: {
      status: 'EXECUTING',
      updatedAt: { lte: cutoff },
    },
    take: SCAN_LIMIT,
    include: {
      agent: { select: { id: true } },
    },
  });

  for (const followup of stale) {
    if (followup.lastCallId) {
      const call = await prisma.call.findUnique({
        where: { id: followup.lastCallId },
        select: { status: true },
      });

      if (call && call.status === 'in_call') {
        await prisma.call.update({
          where: { id: followup.lastCallId },
          data: { status: 'failed', disposition: 'failed' },
        });
      }

      await followupEvalQueue.add('evaluate', { callId: followup.lastCallId }, {
        jobId: `followup-eval-stale-exec-${followup.lastCallId}`,
      });
    } else {
      await prisma.contactFollowup.update({
        where: { id: followup.id },
        data: { status: 'CANCELLED' },
      });
    }
  }

  if (stale.length > 0) {
    log.info('Recovered stale EXECUTING followups', { count: stale.length });
  }
}

async function scanStalePending(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000);

  const stale = await prisma.contactFollowup.findMany({
    where: {
      status: 'PENDING',
      updatedAt: { lte: cutoff },
    },
    take: SCAN_LIMIT,
  });

  if (stale.length > 0) {
    await prisma.contactFollowup.updateMany({
      where: { id: { in: stale.map((s) => s.id) } },
      data: { status: 'CANCELLED' },
    });

    log.info('Cancelled stale PENDING followups', { count: stale.length });
  }
}
