import { Queue, Worker, type Processor, type WorkerOptions, type ConnectionOptions } from 'bullmq';

function parseBullMQConnection(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
  const opts: ConnectionOptions = {
    host: url.hostname,
    port: Number(url.port) || 6379,
    maxRetriesPerRequest: null,
  };
  if (url.password) opts.password = decodeURIComponent(url.password);
  if (url.pathname.length > 1) opts.db = Number(url.pathname.slice(1));
  return opts;
}

const connection = parseBullMQConnection();

export function createQueue(name: string) {
  return new Queue(name, {
    connection,
    defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 500 },
  });
}

export function createWorker<T>(name: string, processor: Processor<T>, opts?: Partial<WorkerOptions>) {
  return new Worker<T>(name, processor, { connection, ...opts });
}

export const outboundQueue = createQueue('outbound-calls');
export const recordingQueue = createQueue('recordings');
export const summaryQueue = createQueue('call-summaries');
export const webhookQueue = new Queue('webhook-delivery', {
  connection,
  defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 2000 },
});
export const appointmentWebhookQueue = new Queue('appointment-webhooks', {
  connection,
  defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 2000 },
});
export const reminderQueue = new Queue('reminder-calls', {
  connection,
  defaultJobOptions: { removeOnComplete: 500, removeOnFail: 1000 },
});

export const whatsappSendQueue = createQueue('whatsapp-send');
export const knowledgeQueue = createQueue('knowledge-processing');
export const mediaQueue = createQueue('media-processing');

export const followupQueue = new Queue('followup-calls', {
  connection,
  defaultJobOptions: { removeOnComplete: 500, removeOnFail: 1000 },
});
export const followupEvalQueue = new Queue('followup-evaluation', {
  connection,
  defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 500 },
});

export const elevenLabsSyncQueue = createQueue('elevenlabs-post-call');

// Lower number = higher priority in BullMQ.
// Inbound calls bypass the queue entirely (Priority 0 effectively).
// Priority 1: reminders + customer-requested callbacks (customer is expecting the call)
// Priority 2: new leads from API — default when call_priority not specified
// Priority 3: automatic follow-ups
// Priority 4: manual dial from dashboard + campaign API calls (call_priority: "campaign")
export const OUTBOUND_PRIORITY = {
  reminder: 1,
  lead: 2,
  followup: 3,
  campaign: 4,
} as const;

export async function scheduleReminderSafetyScan(): Promise<void> {
  await reminderQueue.add(
    'safety-scan',
    {},
    { repeat: { every: 3_600_000 }, jobId: 'reminder-safety-scan' },
  );
}
