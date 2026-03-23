import { prisma } from '@voice/db';
import { createLogger } from '../lib/logger';
import { createWorker } from '../lib/queue';
import { createProvider } from '../services/whatsapp/providers/factory';
import { acquireSendSlot } from '../services/whatsapp/rate-limiter';
import { getSignedUrl } from '../services/media/media-storage.service';
import type { MediaPayload } from '../services/whatsapp/providers/types';

const log = createLogger('whatsapp-send-worker');

async function processMessage(messageId: string, isMedia: boolean): Promise<void> {
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

  const result = isMedia && row.mediaItemId
    ? await sendMediaViaProvider(provider, row)
    : await provider.send(row.contactPhone, row.content);

  if (result.ok) {
    await prisma.whatsappMessage.update({ where: { id: row.id }, data: { status: 'sent', providerMessageId: result.messageId } });
    return;
  }

  if (result.retryable) throw new Error(`WhatsApp retryable error [${result.code}]: ${result.message}`);

  await prisma.whatsappMessage.update({ where: { id: row.id }, data: { status: 'failed', errorCode: result.code } });
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
    item.mediaType === 'image' ? 'image' :
    item.mediaType === 'video' ? 'video' : 'document';

  const media: MediaPayload = {
    url: signedUrl,
    type: providerType,
    caption: row.content || undefined,
    filename: providerType === 'document' ? item.name : undefined,
  };

  return provider.sendMedia(row.contactPhone, media);
}

export function startWhatsappSendWorker() {
  const worker = createWorker<{ messageId: string; isMedia?: boolean }>(
    'whatsapp-send',
    async (job) => {
      await processMessage(job.data.messageId, job.data.isMedia ?? false);
    },
    { concurrency: 5 },
  );

  worker.on('failed', (job, err) => {
    log.warn('whatsapp-send job failed', { messageId: job?.data?.messageId, err: err?.message });
  });

  return worker;
}
