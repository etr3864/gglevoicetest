import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '@voice/db';
import { createLogger } from '../lib/logger';
import { elevenLabsSyncQueue } from '../lib/queue';

const log = createLogger('elevenlabs:webhook');
const router = Router();

router.post('/elevenlabs', handleWebhook);

async function handleWebhook(req: Request, res: Response): Promise<void> {
  const rawBody = getRawBody(req);

  if (!verifySignature(rawBody, req.headers)) {
    log.warn('Invalid ElevenLabs webhook signature');
    res.status(401).end();
    return;
  }

  const payload = parseBody(rawBody, req.body);
  if (!payload) {
    res.status(400).end();
    return;
  }

  const event = payload.type as string;
  const data = payload.data as Record<string, unknown> | undefined;
  const conversationId = data?.conversation_id as string | undefined;
  const agentId = data?.agent_id as string | undefined;

  if (!conversationId) {
    log.warn('Webhook missing conversation_id', { event });
    res.status(200).end();
    return;
  }

  if (!(await isOwnedConversation(conversationId, agentId))) {
    res.status(200).end();
    return;
  }

  log.info('ElevenLabs webhook received', { event, conversationId });

  if (event === 'conversation.ended' || event === 'conversation_ended') {
    await elevenLabsSyncQueue.add(
      'sync',
      { conversationId, externalAgentId: agentId },
      {
        jobId: `el-sync-${conversationId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }

  res.status(200).end();
}

function getRawBody(req: Request): Buffer | null {
  const raw = (req as any).rawBody;
  if (Buffer.isBuffer(raw)) return raw;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  return null;
}

function verifySignature(
  rawBody: Buffer | null,
  headers: Request['headers'],
): boolean {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!rawBody) return false;

  const signature = headers['x-elevenlabs-signature'] as string
    ?? headers['x-signature'] as string;
  if (!signature) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}

function parseBody(
  rawBody: Buffer | null,
  expressBody: unknown,
): Record<string, unknown> | null {
  if (rawBody) {
    try { return JSON.parse(rawBody.toString()); } catch { return null; }
  }
  if (typeof expressBody === 'object' && expressBody !== null) {
    return expressBody as Record<string, unknown>;
  }
  return null;
}

async function isOwnedConversation(conversationId: string, externalAgentId?: string): Promise<boolean> {
  if (!externalAgentId) return true;

  const binding = await prisma.voiceProviderBinding.findFirst({
    where: { provider: 'elevenlabs', externalId: externalAgentId },
    select: { id: true },
  });

  return !!binding;
}

export default router;
