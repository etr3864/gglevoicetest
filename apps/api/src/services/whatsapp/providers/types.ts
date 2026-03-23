export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; retryable: boolean; code: string; message: string };

export interface MediaPayload {
  url: string;
  type: 'image' | 'video' | 'document';
  caption?: string;
  filename?: string;
}

export interface WhatsappProvider {
  send(to: string, text: string, timeoutMs?: number): Promise<SendResult>;
  sendMedia(to: string, media: MediaPayload, timeoutMs?: number): Promise<SendResult>;
}

export interface MetaConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  appSecret: string;
}

export interface WasenderConfig {
  apiKey: string;
  session: string;
  webhookSecret: string;
}
