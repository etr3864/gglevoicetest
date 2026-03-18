import type { WhatsappProvider, SendResult, WasenderConfig } from './types';

const SEND_URL = 'https://www.wasenderapi.com/api/send-message';

function classifyStatus(status: number): { retryable: boolean } {
  if (status === 429 || status === 503 || status === 500) return { retryable: true };
  return { retryable: false };
}

export class WasenderWhatsappProvider implements WhatsappProvider {
  constructor(private readonly config: WasenderConfig) {}

  async send(to: string, text: string, timeoutMs = 10_000): Promise<SendResult> {
    const body = JSON.stringify({ to, text });

    let response: Response;
    try {
      response = await fetch(SEND_URL, {
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
      const data = await response.json() as { data?: { msgId?: number } };
      return { ok: true, messageId: String(data.data?.msgId ?? '') };
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
