import crypto from 'crypto';
import type { Request } from 'express';
import { createLogger } from './logger';

const log = createLogger('telnyx-sig');

const REPLAY_WINDOW_SEC = 300;

function buildPublicKey(raw: string): string {
  return raw.includes('-----')
    ? raw
    : `-----BEGIN PUBLIC KEY-----\n${raw}\n-----END PUBLIC KEY-----`;
}

export function verifyTelnyxWebhook(req: Request): boolean {
  const publicKey = process.env.TELNYX_WEBHOOK_PUBLIC_KEY;
  if (!publicKey) {
    if (process.env.NODE_ENV === 'production') {
      log.error('TELNYX_WEBHOOK_PUBLIC_KEY not set in production — blocking all webhooks');
      return false;
    }
    log.warn('TELNYX_WEBHOOK_PUBLIC_KEY not set — webhook unverified (dev mode)');
    return true;
  }

  const signature = req.headers['telnyx-signature-ed25519'] as string | undefined;
  const timestamp = req.headers['telnyx-timestamp'] as string | undefined;
  const rawBody = (req as any).rawBody as Buffer | undefined;

  if (!signature || !timestamp || !rawBody) return false;

  const tsNum = parseInt(timestamp, 10);
  if (isNaN(tsNum)) return false;

  const age = Date.now() / 1000 - tsNum;
  if (age > REPLAY_WINDOW_SEC || age < -60) return false;

  try {
    const message = Buffer.from(`${timestamp}|${rawBody.toString()}`);
    const sigBuf = Buffer.from(signature, 'base64');
    return crypto.verify(null, message, buildPublicKey(publicKey), sigBuf);
  } catch (err) {
    log.error('Signature verification threw — check TELNYX_WEBHOOK_PUBLIC_KEY format', err);
    return false;
  }
}
