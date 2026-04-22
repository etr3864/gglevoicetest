import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';

const log = createLogger('media:cron');

const STALE_THRESHOLD_MS = 15 * 60 * 1000;
const SCAN_INTERVAL_MS = 5 * 60 * 1000;

export function startMediaCrons(): void {
  setInterval(cleanupStaleItems, SCAN_INTERVAL_MS);
}

async function cleanupStaleItems(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

  const batch = await prisma.mediaItem.findMany({
    where: { status: 'processing', createdAt: { lte: cutoff } },
    take: 500,
    select: { id: true },
  });
  if (batch.length === 0) return;

  const result = await prisma.mediaItem.updateMany({
    where: { id: { in: batch.map(m => m.id) } },
    data: { status: 'error', errorMsg: 'Processing timed out' },
  });

  log.warn('Marked stale media items as error', { count: result.count });
}
