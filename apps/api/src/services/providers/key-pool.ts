import { createLogger } from '../../lib/logger';

const log = createLogger('key-pool');

export class KeyPool {
  private keys: string[] = [];
  private index = 0;
  private cooldowns = new Map<string, number>();

  private static readonly COOLDOWN_MS = 60_000;

  constructor(keys?: string[]) {
    this.keys = keys ?? this.loadFromEnv();
    if (this.keys.length === 0) {
      log.warn('No API keys configured - set GEMINI_API_KEYS');
    }
  }

  next(): string {
    if (this.keys.length === 0) throw new Error('No API keys available');

    const now = Date.now();
    const total = this.keys.length;

    for (let i = 0; i < total; i++) {
      const idx = (this.index + i) % total;
      const key = this.keys[idx];
      if (now >= (this.cooldowns.get(key) ?? 0)) {
        this.index = (idx + 1) % total;
        return key;
      }
    }

    log.warn('All keys on cooldown');
    this.index = (this.index + 1) % total;
    return this.keys[this.index];
  }

  markRateLimited(key: string): void {
    this.cooldowns.set(key, Date.now() + KeyPool.COOLDOWN_MS);
    log.warn('Key rate limited', { keyPrefix: key.slice(0, 8) });
  }

  get size(): number {
    return this.keys.length;
  }

  private loadFromEnv(): string[] {
    const raw = process.env.GEMINI_API_KEYS || '';
    return raw.split(',').map(k => k.trim()).filter(Boolean);
  }
}

export const geminiKeyPool = new KeyPool();
