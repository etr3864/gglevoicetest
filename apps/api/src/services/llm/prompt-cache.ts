import { redis } from '../../lib/redis';
import type { ProviderConfig } from '../providers/types';

const TTL_SECONDS = 30 * 60;
const KEY_PREFIX = 'prompt:call:';

export async function getCachedPrompt(callId: string): Promise<ProviderConfig | null> {
  const raw = await redis.get(`${KEY_PREFIX}${callId}`);
  if (!raw) return null;
  return JSON.parse(raw) as ProviderConfig;
}

export async function setCachedPrompt(callId: string, config: ProviderConfig): Promise<void> {
  await redis.set(`${KEY_PREFIX}${callId}`, JSON.stringify(config), 'EX', TTL_SECONDS);
}

export async function invalidatePromptCache(callId: string): Promise<void> {
  await redis.del(`${KEY_PREFIX}${callId}`);
}
