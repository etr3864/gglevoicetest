import { prisma } from '@voice/db';
import { createLogger } from '../../../lib/logger';
import { elevenLabsSyncQueue } from '../../../lib/queue';

const log = createLogger('elevenlabs:orphan-cron');

const STUCK_THRESHOLD_MS = 30 * 60 * 1000;
const SCAN_INTERVAL_MS = 15 * 60 * 1000;

export function startElevenLabsOrphanCron(): void {
  setInterval(scanStuckCalls, SCAN_INTERVAL_MS);
}

async function scanStuckCalls(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

  const stuckCalls = await prisma.call.findMany({
    where: {
      status: 'in_call',
      externalConversationId: { not: null },
      startedAt: { lte: cutoff },
      agent: { voiceProvider: 'elevenlabs' },
    },
    select: { id: true, externalConversationId: true },
    take: 50,
  });

  if (stuckCalls.length === 0) return;

  log.info('Found stuck ElevenLabs calls', { count: stuckCalls.length });

  for (const call of stuckCalls) {
    await elevenLabsSyncQueue
      .add(
        'orphan-sync',
        { conversationId: call.externalConversationId! },
        {
          jobId: `el-orphan-${call.id}`,
          attempts: 2,
          backoff: { type: 'exponential', delay: 10000 },
        },
      )
      .catch((err) => {
        log.warn('Failed to enqueue orphan sync', { callId: call.id, err: String(err) });
      });
  }
}
