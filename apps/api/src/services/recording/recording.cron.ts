import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { fetchRecordingByCallControlId } from '../telnyx';
import { handleRecordingWebhook } from './recording.service';

const log = createLogger('recording-cron');

const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

export function startRecordingCrons(): void {
  setInterval(orphanScan, ONE_HOUR);
  setInterval(cleanupFailed, ONE_DAY);
}

async function orphanScan(): Promise<void> {
  const since = new Date(Date.now() - 7 * ONE_DAY);
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);

  const candidates = await prisma.call.findMany({
    where: {
      status: 'completed',
      recordingStatus: null,
      callControlId: { not: null },
      endedAt: { gte: since, lte: cutoff },
    },
    take: 50,
  });

  if (candidates.length === 0) return;

  log.info('Orphan scan: checking candidates', { count: candidates.length });
  let found = 0;

  for (const call of candidates) {
    try {
      const rec = await fetchRecordingByCallControlId(call.callControlId!);
      if (!rec) continue;

      found++;
      log.info('Orphan recording found', { callId: call.id, recordingId: rec.id });

      await handleRecordingWebhook({
        telnyxRecordingId: rec.id,
        callControlId: call.callControlId!,
        downloadUrl: rec.download_urls.mp3,
        durationMs: rec.duration_millis,
      });
    } catch (err) {
      log.error('Orphan scan error for call', err, { callId: call.id });
    }
  }

  if (found > 0) log.info('Orphan scan complete', { found });
}

async function cleanupFailed(): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * ONE_DAY);

  const result = await prisma.call.updateMany({
    where: { recordingStatus: 'failed', endedAt: { lte: cutoff } },
    data: { recordingStatus: null },
  });

  if (result.count > 0) {
    log.info('Cleanup: reset failed recordings', { count: result.count });
  }
}
