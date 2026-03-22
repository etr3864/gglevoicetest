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

  const result = await prisma.knowledgeDocument.updateMany({
    where: { status: 'processing', createdAt: { lte: cutoff } },
    data: { status: 'error', errorMsg: 'Processing timed out' },
  });

  if (result.count > 0) {
    log.warn('Marked stale documents as error', { count: result.count });
  }
}
