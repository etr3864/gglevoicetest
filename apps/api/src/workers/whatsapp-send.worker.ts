import { prisma } from '@voice/db';
import { createLogger } from '../lib/logger';
import { createWorker } from '../lib/queue';
import { createProvider } from '../services/whatsapp/providers/factory';
import { acquireSendSlot } from '../services/whatsapp/rate-limiter';

const log = createLogger('whatsapp-send-worker');

async function processMessage(messageId: string): Promise<void> {
  const row = await prisma.whatsappMessage.findUnique({
    where: { id: messageId },
    include: { agent: { select: { whatsappProvider: true, whatsappConfig: true } } },
  });

  if (!row) return;
  if (row.status !== 'pending') return;
  if (row.providerMessageId !== null) return;

  const agent = row.agent;
  if (!agent.whatsappProvider) {
    await prisma.whatsappMessage.update({
      where: { id: row.id },
      data: { status: 'failed', errorCode: 'NO_PROVIDER' },
    });
    return;
  }

  const provider = createProvider({ whatsappProvider: agent.whatsappProvider, whatsappConfig: agent.whatsappConfig });

  await acquireSendSlot(row.agentId, agent.whatsappProvider);

  const result = await provider.send(row.contactPhone, row.content);

  if (result.ok) {
    await prisma.whatsappMessage.update({
      where: { id: row.id },
      data: { status: 'sent', providerMessageId: result.messageId },
    });
    return;
  }

  if (result.retryable) {
    throw new Error(`WhatsApp retryable error [${result.code}]: ${result.message}`);
  }

  await prisma.whatsappMessage.update({
    where: { id: row.id },
    data: { status: 'failed', errorCode: result.code },
  });
}

export function startWhatsappSendWorker() {
  const worker = createWorker<{ messageId: string }>(
    'whatsapp-send',
    async (job) => {
      await processMessage(job.data.messageId);
    },
    { concurrency: 5 },
  );

  worker.on('failed', (job, err) => {
    log.warn('whatsapp-send job failed', { messageId: job?.data?.messageId, err: err?.message });
  });

  return worker;
}
