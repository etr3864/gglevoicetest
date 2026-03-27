export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; retryable: boolean; code: string; message: string };

export interface MediaPayload {
  url: string;
  type: 'image' | 'video' | 'document';
  caption?: string;
  filename?: string;
}

export type TemplateHeaderFormat = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';

export interface TemplatePayload {
  name: string;
  language: string;
  variables: Record<string, string>;
  header?: { format: TemplateHeaderFormat; text?: string; mediaUrl?: string; filename?: string };
  buttons?: { type: string; index: number }[];
}

export interface WhatsappProvider {
  send(to: string, text: string, timeoutMs?: number): Promise<SendResult>;
  sendMedia(to: string, media: MediaPayload, timeoutMs?: number): Promise<SendResult>;
  sendTemplate?(to: string, payload: TemplatePayload, timeoutMs?: number): Promise<SendResult>;
}

export interface MetaConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  appSecret: string;
  wabaId?: string;
  appId?: string;
}

export interface WasenderConfig {
  apiKey: string;
  session: string;
  webhookSecret: string;
}
