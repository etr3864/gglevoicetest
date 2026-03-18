import { redis } from '../../lib/redis';

// Token bucket: Meta 60/s, WA Sender 4/s (safety margins under actual limits)
const LIMITS: Record<string, { tokens: number; windowMs: number }> = {
  meta: { tokens: 60, windowMs: 1000 },
  wasender: { tokens: 4, windowMs: 1000 },
};

// Atomic Lua: increment counter, set TTL if new key, return remaining
const LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local current = redis.call('INCR', key)
if current == 1 then
  redis.call('PEXPIRE', key, windowMs)
end
if current > limit then
  return -1
end
return limit - current
`;

export async function acquireSendSlot(agentId: string, provider: string): Promise<void> {
  const limit = LIMITS[provider] ?? LIMITS.meta;
  const key = `wa:rate:${provider}:${agentId}:${Math.floor(Date.now() / limit.windowMs)}`;
  const result = await (redis as any).eval(LUA, 1, key, limit.tokens, limit.windowMs) as number;
  if (result === -1) {
    throw new Error(`WhatsApp rate limit reached for provider ${provider}`);
  }
}
