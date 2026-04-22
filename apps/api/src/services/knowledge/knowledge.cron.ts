import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';

const log = createLogger('knowledge:cron');

const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
const SCAN_INTERVAL_MS = 5 * 60 * 1000;    // every 5 minutes

export function startKnowledgeCrons(): void {
  setInterval(cleanupStaleDocuments, SCAN_INTERVAL_MS);
}

async function cleanupStaleDocuments(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

  const batch = await prisma.knowledgeDocument.findMany({
    where: { status: 'processing', createdAt: { lte: cutoff } },
    take: 500,
    select: { id: true },
  });
  if (batch.length === 0) return;

  const result = await prisma.knowledgeDocument.updateMany({
    where: { id: { in: batch.map(d => d.id) } },
    data: { status: 'error', errorMsg: 'Processing timed out' },
  });

  log.warn('Marked stale documents as error', { count: result.count });
}
