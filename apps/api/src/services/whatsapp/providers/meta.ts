import type { WhatsappProvider, SendResult, MetaConfig } from './types';

const RETRYABLE_CODES = new Set([130429, 131056, 2, 131016, 131057, 133004, 1, 131000]);

function classifyMetaError(status: number, code: number | undefined): { retryable: boolean } {
  if (status >= 500) return { retryable: true };
  if (code !== undefined && RETRYABLE_CODES.has(code)) return { retryable: true };
  return { retryable: false };
}

export class MetaWhatsappProvider implements WhatsappProvider {
  constructor(private readonly config: MetaConfig) {}

  async send(to: string, text: string, timeoutMs = 10_000): Promise<SendResult> {
    const url = `https://graph.facebook.com/v22.0/${this.config.phoneNumberId}/messages`;
    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
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
      const data = await response.json() as { messages?: { id: string }[] };
      const messageId = data.messages?.[0]?.id ?? '';
      return { ok: true, messageId };
    }

    let errorCode: number | undefined;
    let errorMessage = `HTTP ${response.status}`;
    try {
      const err = await response.json() as { error?: { code?: number; message?: string } };
      errorCode = err.error?.code;
      errorMessage = err.error?.message ?? errorMessage;
    } catch {
      // ignore parse failure
    }

    const { retryable } = classifyMetaError(response.status, errorCode);
    return { ok: false, retryable, code: String(errorCode ?? response.status), message: errorMessage };
  }
}
