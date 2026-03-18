import { prisma } from '@voice/db';
import { normalizePhone } from '../../lib/phone';
import { whatsappSendQueue } from '../../lib/queue';

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
