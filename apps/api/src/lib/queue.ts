import { Queue, Worker, type Processor, type WorkerOptions, type ConnectionOptions } from 'bullmq';
import { redis } from './redis';

const connection = redis as unknown as ConnectionOptions;

export function createQueue(name: string) {
  return new Queue(name, { connection });
}

export function createWorker<T>(name: string, processor: Processor<T>, opts?: Partial<WorkerOptions>) {
  return new Worker<T>(name, processor, { connection, ...opts });
}

export const outboundQueue = createQueue('outbound-calls');
