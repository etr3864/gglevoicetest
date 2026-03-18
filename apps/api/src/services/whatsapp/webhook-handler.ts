import crypto from 'crypto';
import { prisma } from '@voice/db';
import { redis } from '../../lib/redis';
import { createLogger } from '../../lib/logger';
import { decryptConfig } from './config-crypto';

const log = createLogger('whatsapp-webhook');

export function verifyMetaSignature(rawBody: Buffer, signature: string, appSecret: string): boolean {
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function verifyWasenderSignature(rawBody: Buffer, signature: string, webhookSecret: string): boolean {
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function verifyMetaChallenge(
  query: Record<string, string | undefined>,
  verifyToken: string,
): string | null {
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken) {
    return query['hub.challenge'] ?? null;
  }
  return null;
}

async function dedupInbound(messageId: string): Promise<boolean> {
  const key = `wa:dedup:${messageId}`;
  const result = await redis.set(key, '1', 'NX', 'EX', 86400);
  return result === 'OK';
}

export async function handleMetaWebhook(body: unknown, agentId: string): Promise<void> {
  const payload = body as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<{ id: string; from: string; text?: { body: string }; type: string; timestamp: string }>;
          statuses?: Array<{ id: string; status: string; recipient_id: string }>;
        };
      }>;
    }>;
  };

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      for (const msg of value.messages ?? []) {
        if (msg.type !== 'text' || !msg.text?.body) continue;

        const isNew = await dedupInbound(msg.id);
        if (!isNew) continue;

        await prisma.whatsappMessage.create({
          data: {
            agentId,
            contactPhone: `+${msg.from}`,
            direction: 'inbound',
            status: 'inbound',
            content: msg.text.body,
            providerMessageId: msg.id,
          },
        });
      }

      for (const status of value.statuses ?? []) {
        const statusMap: Record<string, string> = {
          sent: 'sent',
          delivered: 'delivered',
          read: 'read',
          failed: 'failed',
        };
        const mapped = statusMap[status.status];
        if (!mapped) continue;

        await prisma.whatsappMessage.updateMany({
          where: { providerMessageId: status.id, agentId },
          data: { status: mapped },
        });
      }
    }
  }
}

export async function handleWasenderWebhook(body: unknown, agentId: string): Promise<void> {
  const payload = body as {
    event?: string;
    data?: {
      id?: string;
      from?: string;
      body?: string;
      type?: string;
    };
  };

  if (payload.event !== 'message' || payload.data?.type !== 'chat') return;

  const data = payload.data;
  if (!data?.id || !data.from || !data.body) return;

  const isNew = await dedupInbound(data.id);
  if (!isNew) return;

  const phone = `+${data.from.replace('@c.us', '')}`;

  await prisma.whatsappMessage.create({
    data: {
      agentId,
      contactPhone: phone,
      direction: 'inbound',
      status: 'inbound',
      content: data.body,
      providerMessageId: data.id,
    },
  });
}

export async function loadAgentWhatsappConfig(agentId: string): Promise<{
  verifyToken?: string;
  appSecret?: string;
  webhookSecret?: string;
  provider: string;
} | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { whatsappProvider: true, whatsappConfig: true },
  });

  if (!agent?.whatsappProvider || !agent.whatsappConfig) return null;

  try {
    const config = decryptConfig(agent.whatsappConfig) as Record<string, string>;
    return { ...config, provider: agent.whatsappProvider };
  } catch (err) {
    log.error('Failed to decrypt whatsapp config', err, { agentId });
    return null;
  }
}
