import { createLogger } from '../lib/logger';
import { createWorker } from '../lib/queue';
import { deliverAppointmentWebhook, type AppointmentEvent } from '../services/calendar/appointment-webhook.service';

const log = createLogger('appointment-webhook-worker');

interface AppointmentWebhookJob {
  appointmentId: string;
  event: AppointmentEvent;
}

export function startAppointmentWebhookWorker() {
  const worker = createWorker<AppointmentWebhookJob>(
    'appointment-webhooks',
    async (job) => {
      await deliverAppointmentWebhook(job.data.appointmentId, job.data.event);
    },
    { concurrency: 5 },
  );

  worker.on('failed', (job, err) => {
    log.error('Job failed', undefined, {
      jobId: job?.id,
      appointmentId: job?.data?.appointmentId,
      event: job?.data?.event,
      reason: err?.message?.slice(0, 150),
    });
  });

  return worker;
}
