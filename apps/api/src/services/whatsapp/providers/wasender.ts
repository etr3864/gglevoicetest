import type { WhatsappProvider, SendResult, WasenderConfig, MediaPayload } from './types';

const SEND_URL = 'https://www.wasenderapi.com/api/send-message';

function classifyStatus(status: number): { retryable: boolean } {
  if (status === 429 || status === 503 || status === 500) return { retryable: true };
  return { retryable: false };
}

export class WasenderWhatsappProvider implements WhatsappProvider {
  constructor(private readonly config: WasenderConfig) {}

  async send(to: string, text: string, timeoutMs = 10_000): Promise<SendResult> {
    return this.post({ to, text }, timeoutMs);
  }

  async sendMedia(to: string, media: MediaPayload, timeoutMs = 60_000): Promise<SendResult> {
    const body: Record<string, string | undefined> = { to };

    if (media.type === 'image') body.imageUrl = media.url;
    else if (media.type === 'video') body.videoUrl = media.url;
    else { body.documentUrl = media.url; body.fileName = media.filename; }

    if (media.caption) body.text = media.caption;

    return this.post(body, timeoutMs);
  }

  private async post(payload: Record<string, string | undefined>, timeoutMs: number): Promise<SendResult> {
    let response: Response;
    try {
      response = await fetch(SEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
    } catch { /* ignore */ }

    return { ok: false, retryable, code: String(response.status), message: errorMessage };
  }
}
