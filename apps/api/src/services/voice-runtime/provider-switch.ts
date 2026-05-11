import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { getRuntime } from './registry';
import type { VoiceProviderId } from './types';

const log = createLogger('voice:switch');

export async function switchProvider(
  agentId: string,
  from: VoiceProviderId,
  to: VoiceProviderId,
): Promise<void> {
  if (from === to) return;

  const activeCalls = await prisma.call.count({
    where: { agentId, status: 'in_call' },
  });

  if (activeCalls > 0) {
    throw new Error('Cannot switch provider while agent has active calls');
  }

  const newRuntime = getRuntime(to);
  await newRuntime.onAgentCreated(agentId);

  await prisma.agent.update({
    where: { id: agentId },
    data: { voiceProvider: to },
  });

  const oldRuntime = getRuntime(from);
  try {
    await oldRuntime.onProviderSwitchedAway(agentId);
  } catch (err) {
    log.error('Old provider cleanup failed (non-blocking)', err, { agentId, from });
  }

  if (to === 'elevenlabs') {
    await cancelPendingReminders(agentId);
  }

  log.info('Provider switched', { agentId, from, to });
}

async function cancelPendingReminders(agentId: string): Promise<void> {
  const { count } = await prisma.scheduledReminder.updateMany({
    where: { agentId, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  });

  if (count > 0) {
    log.info('Cancelled pending reminders for ElevenLabs switch', { agentId, count });
  }
}
