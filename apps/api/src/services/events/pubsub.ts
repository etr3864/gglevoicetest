import { redis } from '../../lib/redis';
import { sseManager } from './sse.manager';
import { createLogger } from '../../lib/logger';

const log = createLogger('events-pubsub');
const CHANNEL = 'agent-events';

// We need a duplicate client for subscribing because a client in subscriber mode
// cannot issue other commands (like publish)
const subscriber = redis.duplicate();

export async function initPubSub(): Promise<void> {
  await subscriber.subscribe(CHANNEL);
  
  subscriber.on('message', (channel, message) => {
    if (channel !== CHANNEL) return;
    try {
      const { agentId, event, data } = JSON.parse(message);
      sseManager.broadcastToAgent(agentId, event, data);
    } catch (err) {
      log.error('Failed to parse pubsub message', err);
    }
  });
}

export async function publishCallEvent(agentId: string, event: string, data: unknown): Promise<void> {
  try {
    await redis.publish(CHANNEL, JSON.stringify({ agentId, event, data }));
  } catch (err) {
    log.error('Failed to publish event', err, { agentId, event });
  }
}

export async function closePubSub(): Promise<void> {
  await subscriber.quit();
}
