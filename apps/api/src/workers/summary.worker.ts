import { createLogger } from '../lib/logger';
import { createWorker } from '../lib/queue';
import { generateCallSummary } from '../services/summary/summary.service';

const log = createLogger('summary-worker');

export function startSummaryWorker() {
  const worker = createWorker<{ callId: string }>(
    'call-summaries',
    (job) => generateCallSummary(job.data.callId),
    { concurrency: 3 },
  );

  worker.on('failed', (job, err) => {
    log.error('Summary job failed', undefined, {
      jobId: job?.id,
      callId: job?.data?.callId,
      attempt: job?.attemptsMade,
      reason: err?.message?.slice(0, 150),
    });
  });

  return worker;
}
