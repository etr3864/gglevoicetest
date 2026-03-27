import { prisma } from '@voice/db';
import { createLogger } from '../lib/logger';
import { createWorker } from '../lib/queue';
import { createProvider } from '../services/whatsapp/providers/factory';
import { acquireSendSlot } from '../services/whatsapp/rate-limiter';
import { getSignedUrl } from '../services/media/media-storage.service';
import type { MediaPayload, TemplatePayload, TemplateHeaderFormat } from '../services/whatsapp/providers/types';

const log = createLogger('whatsapp-send-worker');

async function processMessage(messageId: string, isMedia: boolean, isTemplate: boolean): Promise<void> {
  const row = await prisma.whatsappMessage.findUnique({
    where: { id: messageId },
    include: { agent: { select: { whatsappProvider: true, whatsappConfig: true } } },
  });

  if (!row || row.status !== 'pending' || row.providerMessageId !== null) return;

  const agent = row.agent;
  if (!agent.whatsappProvider) {
    await prisma.whatsappMessage.update({ where: { id: row.id }, data: { status: 'failed', errorCode: 'NO_PROVIDER' } });
    return;
  }

  const provider = createProvider({ whatsappProvider: agent.whatsappProvider, whatsappConfig: agent.whatsappConfig });
  await acquireSendSlot(row.agentId, agent.whatsappProvider);

  const result = isTemplate && row.templateName
    ? await sendTemplateViaProvider(provider, row)
    : isMedia && row.mediaItemId
      ? await sendMediaViaProvider(provider, row)
      : await provider.send(row.contactPhone, row.content);

  if (result.ok) {
    await prisma.whatsappMessage.update({ where: { id: row.id }, data: { status: 'sent', providerMessageId: result.messageId } });
    return;
  }

  if (result.retryable) throw new Error(`WhatsApp retryable error [${result.code}]: ${result.message}`);

  await prisma.whatsappMessage.update({ where: { id: row.id }, data: { status: 'failed', errorCode: result.code } });
}

async function sendTemplateViaProvider(
  provider: ReturnType<typeof createProvider>,
  row: { agentId: string; contactPhone: string; templateName: string | null; templateVars: unknown; mediaItemId: string | null; mediaName: string | null },
) {
  if (!provider.sendTemplate) {
    return { ok: false as const, retryable: false, code: 'NO_TEMPLATE_SUPPORT', message: 'Provider does not support templates' };
  }

  const template = await prisma.whatsappTemplate.findFirst({
    where: { agentId: row.agentId, name: row.templateName! },
    select: { name: true, language: true, components: true },
  });

  if (!template) {
    return { ok: false as const, retryable: false, code: 'TEMPLATE_NOT_FOUND', message: `Template "${row.templateName}" not found` };
  }

  const variables = (row.templateVars as Record<string, string>) ?? {};
  const payload: TemplatePayload = {
    name: template.name,
    language: template.language,
    variables,
    header: await buildHeaderPayload(template.components, row.mediaItemId, row.mediaName),
  };

  return provider.sendTemplate(row.contactPhone, payload);
}

async function buildHeaderPayload(
  components: unknown,
  mediaItemId: string | null,
  mediaName: string | null,
): Promise<TemplatePayload['header'] | undefined> {
  const comps = components as Array<{ type: string; format?: string; text?: string }>;
  const header = comps?.find((c) => c.type === 'HEADER');
  if (!header?.format) return undefined;

  const format = header.format as TemplateHeaderFormat;

  if (format === 'TEXT') return { format, text: header.text };

  if (!mediaItemId) return { format };

  const item = await prisma.mediaItem.findUnique({
    where: { id: mediaItemId },
    select: { gcsPath: true, name: true },
  });
  if (!item) return { format };

  const mediaUrl = await getSignedUrl(item.gcsPath, 15);
  return { format, mediaUrl, filename: format === 'DOCUMENT' ? (mediaName ?? item.name) : undefined };
}

async function sendMediaViaProvider(
  provider: ReturnType<typeof createProvider>,
  row: { contactPhone: string; content: string; mediaItemId: string | null; mediaType: string | null; mediaName: string | null },
) {
  const item = await prisma.mediaItem.findUnique({
    where: { id: row.mediaItemId! },
    select: { gcsPath: true, mediaType: true, mimeType: true, name: true },
  });

  if (!item) return provider.send(row.contactPhone, row.content);

  const signedUrl = await getSignedUrl(item.gcsPath, 15);
  const providerType: MediaPayload['type'] =
    item.mediaType === 'image' ? 'image' : item.mediaType === 'video' ? 'video' : 'document';

  const media: MediaPayload = {
    url: signedUrl,
    type: providerType,
    caption: row.content || undefined,
    filename: providerType === 'document' ? item.name : undefined,
  };

  return provider.sendMedia(row.contactPhone, media);
}

export function startWhatsappSendWorker() {
  const worker = createWorker<{ messageId: string; isMedia?: boolean; isTemplate?: boolean }>(
    'whatsapp-send',
    async (job) => {
      await processMessage(job.data.messageId, job.data.isMedia ?? false, job.data.isTemplate ?? false);
    },
    { concurrency: 5 },
  );

  worker.on('failed', (job, err) => {
    log.warn('whatsapp-send job failed', { messageId: job?.data?.messageId, err: err?.message });
  });

  return worker;
}
