import type { WhatsappProvider, SendResult, WasenderConfig } from './types';

function toJid(e164: string): string {
  return `${e164.replace(/^\+/, '')}@c.us`;
}

function classifyStatus(status: number): { retryable: boolean } {
  if (status === 429 || status === 503 || status === 500) return { retryable: true };
  return { retryable: false };
}

export class WasenderWhatsappProvider implements WhatsappProvider {
  constructor(private readonly config: WasenderConfig) {}

  async send(to: string, text: string, timeoutMs = 10_000): Promise<SendResult> {
    const url = `https://api.wasenderapi.com/api/send-text`;
    const body = JSON.stringify({
      session: this.config.session,
      to: toJid(to),
      text,
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      return { ok: false, retryable: true, code: 'TIMEOUT', message };
    }

    if (response.ok) {
      const data = await response.json() as { id?: string };
      return { ok: true, messageId: data.id ?? '' };
    }

    const { retryable } = classifyStatus(response.status);
    let errorMessage = `HTTP ${response.status}`;
    try {
      const err = await response.json() as { message?: string };
      errorMessage = err.message ?? errorMessage;
    } catch {
      // ignore
    }

    return { ok: false, retryable, code: String(response.status), message: errorMessage };
  }
}
