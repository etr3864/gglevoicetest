import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { followupQueue } from '../../lib/queue';

const log = createLogger('followup-cancel');

export async function cancelActiveFollowup(contactId: string, agentId: string, reason: string): Promise<void> {
  const active = await prisma.contactFollowup.findFirst({
    where: {
      contactId,
      agentId,
      status: { in: ['PENDING', 'SCHEDULED'] },
    },
  });

  if (!active) return;

  if (active.bullmqJobId) {
    try {
      await followupQueue.remove(active.bullmqJobId);
    } catch {}
  }

  await prisma.contactFollowup.update({
    where: { id: active.id },
    data: { status: 'CANCELLED' },
  });

  log.info('Cancelled followup', { followupId: active.id, contactId, agentId, reason });
}

export async function optOutContact(contactId: string, agentId: string): Promise<void> {
  const active = await prisma.contactFollowup.findFirst({
    where: {
      contactId,
      agentId,
      status: { in: ['PENDING', 'SCHEDULED'] },
    },
  });

  if (!active) {
    await prisma.contactFollowup.create({
      data: {
        contactId,
        agentId,
        currentStepOrder: 0,
        status: 'OPTED_OUT',
      },
    }).catch((err: any) => {
      if (err?.code === 'P2002') return;
      throw err;
    });
    return;
  }

  if (active.bullmqJobId) {
    try {
      await followupQueue.remove(active.bullmqJobId);
    } catch {}
  }

  await prisma.contactFollowup.update({
    where: { id: active.id },
    data: { status: 'OPTED_OUT' },
  });

  log.info('Contact opted out', { followupId: active.id, contactId, agentId });
}
