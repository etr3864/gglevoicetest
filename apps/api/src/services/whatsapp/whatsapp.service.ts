import { prisma } from '@voice/db';
import { normalizePhone } from '../../lib/phone';
import { whatsappSendQueue } from '../../lib/queue';
import { upsertMonthlyUsage } from '../usage/usage.service';
import type { MediaContextItem } from '../media/types';

const INBOUND_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function hasRecentInbound(agentId: string, contactPhone: string): Promise<boolean> {
  const phone = normalizePhone(contactPhone);
  const since = new Date(Date.now() - INBOUND_WINDOW_MS);
  const msg = await prisma.whatsappMessage.findFirst({
    where: { agentId, contactPhone: phone, direction: 'inbound', createdAt: { gte: since } },
    select: { id: true },
  });
  return msg !== null;
}

function renderTemplateBody(components: unknown, variables: Record<string, string>): string {
  const comps = components as Array<{ type: string; text?: string }>;
  const bodyComp = comps?.find((c) => c.type === 'BODY');
  if (!bodyComp?.text) return '';
  return bodyComp.text.replace(/\{\{(\d+)\}\}/g, (_, n) => variables[n] ?? `{{${n}}}`);
}

export async function sendTemplateMessage(
  agentId: string,
  contactPhone: string,
  templateName: string,
  language: string,
  variables: Record<string, string>,
  mediaItemId?: string,
  callId?: string,
): Promise<void> {
  const phone = normalizePhone(contactPhone);

  const template = await prisma.whatsappTemplate.findUnique({
    where: { agentId_name_language: { agentId, name: templateName, language } },
    select: { components: true, status: true },
  });

  if (!template || template.status !== 'APPROVED') {
    throw new Error(`Template "${templateName}" not found or not approved`);
  }

  const content = renderTemplateBody(template.components, variables);

  const row = await prisma.whatsappMessage.create({
    data: {
      agentId,
      contactPhone: phone,
      direction: 'outbound',
      status: 'pending',
      content,
      templateName,
      templateVars: variables,
      mediaItemId: mediaItemId ?? null,
      callId: callId ?? null,
    },
  });

  try {
    await whatsappSendQueue.add(
      'send',
      { messageId: row.id, isTemplate: true },
      { jobId: row.id, attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 500 },
    );
    upsertMonthlyUsage(agentId, { whatsappMsgCount: 1 }).catch(() => {});
  } catch (err) {
    await prisma.whatsappMessage.update({ where: { id: row.id }, data: { status: 'failed', errorCode: 'ENQUEUE_FAILED' } });
    throw err;
  }
}

export async function sendMessage(
  agentId: string,
  contactPhone: string,
  text: string,
  callId?: string,
): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { whatsappProvider: true },
  });

  if (!agent?.whatsappProvider) {
    throw new Error('Agent has no WhatsApp provider configured');
  }

  const phone = normalizePhone(contactPhone);

  const row = await prisma.whatsappMessage.create({
    data: {
      agentId,
      contactPhone: phone,
      direction: 'outbound',
      status: 'pending',
      content: text,
      callId: callId ?? null,
    },
  });

  try {
    await whatsappSendQueue.add(
      'send',
      { messageId: row.id },
      {
        jobId: row.id,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 500,
      },
    );

    upsertMonthlyUsage(agentId, { whatsappMsgCount: 1 }).catch(() => {});
  } catch (err) {
    await prisma.whatsappMessage.update({
      where: { id: row.id },
      data: { status: 'failed', errorCode: 'ENQUEUE_FAILED' },
    });
    throw err;
  }
}

export async function sendMediaMessage(
  agentId: string,
  contactPhone: string,
  mediaItem: MediaContextItem & { gcsPath: string },
  captionOverride: string | undefined,
  callId?: string,
): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { whatsappProvider: true },
  });
  if (!agent?.whatsappProvider) throw new Error('Agent has no WhatsApp provider configured');

  const phone = normalizePhone(contactPhone);
  const caption = captionOverride ?? mediaItem.caption ?? '';

  const row = await prisma.whatsappMessage.create({
    data: {
      agentId,
      contactPhone: phone,
      direction: 'outbound',
      status: 'pending',
      content: caption,
      callId: callId ?? null,
      mediaItemId: mediaItem.id,
      mediaType: mediaItem.mediaType,
      mediaName: mediaItem.name,
    },
  });

  try {
    await whatsappSendQueue.add(
      'send',
      { messageId: row.id, isMedia: true },
      { jobId: row.id, attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 500 },
    );
    upsertMonthlyUsage(agentId, { whatsappMsgCount: 1 }).catch(() => {});
  } catch (err) {
    await prisma.whatsappMessage.update({
      where: { id: row.id },
      data: { status: 'failed', errorCode: 'ENQUEUE_FAILED' },
    });
    throw err;
  }
}

export async function getContextMessages(
  agentId: string,
  contactPhone: string,
  limit: number,
) {
  const phone = normalizePhone(contactPhone);
  const messages = await prisma.whatsappMessage.findMany({
    where: {
      agentId,
      contactPhone: phone,
      status: { in: ['sent', 'delivered', 'read', 'inbound'] },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { direction: true, content: true, createdAt: true, status: true },
  });
  return messages.reverse();
}
