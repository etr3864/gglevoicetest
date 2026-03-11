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
  return new Queue(name, { connection });
}

export function createWorker<T>(name: string, processor: Processor<T>, opts?: Partial<WorkerOptions>) {
  return new Worker<T>(name, processor, { connection, ...opts });
}

export const outboundQueue = createQueue('outbound-calls');
