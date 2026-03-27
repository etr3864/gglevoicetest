import { createLogger } from '../../../lib/logger';
import type { WhatsappProvider, SendResult, MetaConfig, MediaPayload, TemplatePayload } from './types';

const log = createLogger('meta-provider');

const RETRYABLE_CODES = new Set([130429, 131056, 2, 131016, 131057, 133004, 1, 131000]);

function buildTemplateComponents(payload: TemplatePayload): object[] {
  const components: object[] = [];

  if (payload.header) {
    const { format, text, mediaUrl, filename } = payload.header;
    if (format === 'TEXT' && text) {
      components.push({ type: 'header', parameters: [{ type: 'text', text }] });
    } else if (mediaUrl && (format === 'IMAGE' || format === 'VIDEO' || format === 'DOCUMENT')) {
      const mediaType = format.toLowerCase() as 'image' | 'video' | 'document';
      const mediaObj: Record<string, string> = { link: mediaUrl };
      if (format === 'DOCUMENT' && filename) mediaObj.filename = filename;
      components.push({ type: 'header', parameters: [{ type: mediaType, [mediaType]: mediaObj }] });
    }
  }

  const vars = Object.entries(payload.variables).sort(([a], [b]) => Number(a) - Number(b));
  if (vars.length > 0) {
    components.push({
      type: 'body',
      parameters: vars.map(([, value]) => ({ type: 'text', text: value })),
    });
  }

  return components;
}

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

    return this.post(url, body, timeoutMs);
  }

  async sendMedia(to: string, media: MediaPayload, timeoutMs = 60_000): Promise<SendResult> {
    const url = `https://graph.facebook.com/v22.0/${this.config.phoneNumberId}/messages`;
    const mediaObj: Record<string, string | undefined> = { link: media.url };
    if (media.caption) mediaObj.caption = media.caption;
    if (media.filename) mediaObj.filename = media.filename;

    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: media.type,
      [media.type]: mediaObj,
    });

    return this.post(url, body, timeoutMs);
  }

  async sendTemplate(to: string, payload: TemplatePayload, timeoutMs = 15_000): Promise<SendResult> {
    const url = `https://graph.facebook.com/v22.0/${this.config.phoneNumberId}/messages`;
    const components = buildTemplateComponents(payload);
    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: payload.name,
        language: { code: payload.language },
        components,
      },
    });
    return this.post(url, body, timeoutMs);
  }

  private async post(url: string, body: string, timeoutMs: number): Promise<SendResult> {

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.accessToken}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      log.error('Meta API network error', { message });
      return { ok: false, retryable: true, code: 'TIMEOUT', message };
    }

    if (response.ok) {
      const data = await response.json() as { messages?: { id: string }[] };
      return { ok: true, messageId: data.messages?.[0]?.id ?? '' };
    }

    let errorCode: number | undefined;
    let errorMessage = `HTTP ${response.status}`;
    try {
      const err = await response.json() as { error?: { code?: number; message?: string } };
      errorCode = err.error?.code;
      errorMessage = err.error?.message ?? errorMessage;
    } catch { /* ignore */ }

    const { retryable } = classifyMetaError(response.status, errorCode);
    log.error('Meta API error', { status: response.status, errorCode, errorMessage, retryable });
    return { ok: false, retryable, code: String(errorCode ?? response.status), message: errorMessage };
  }
}
