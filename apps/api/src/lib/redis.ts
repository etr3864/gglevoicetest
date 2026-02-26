import Redis from 'ioredis';
import { createLogger } from './logger';

const log = createLogger('redis');

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

redis.on('error', (err) => {
  log.error('Connection error', err);
});
