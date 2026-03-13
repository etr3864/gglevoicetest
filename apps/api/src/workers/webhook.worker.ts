import { createLogger } from '../lib/logger';
import { createWorker } from '../lib/queue';
import { deliverWebhook } from '../services/summary/webhook.service';

const log = createLogger('webhook-worker');

export function startWebhookWorker() {
  const worker = createWorker<{ summaryId: string }>(
    'webhook-delivery',
    (job) => deliverWebhook(job.data.summaryId),
    { concurrency: 5 },
  );

  worker.on('failed', (job, err) => {
    log.error('Webhook job failed', undefined, {
      jobId: job?.id,
      summaryId: job?.data?.summaryId,
      reason: err?.message?.slice(0, 150),
    });
  });

  return worker;
}
