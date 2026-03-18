import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { recordingQueue } from '../../lib/queue';
import { startRecording as telnyxStartRecording } from '../telnyx';
import { upsertMonthlyUsage } from '../usage/usage.service';

const log = createLogger('recording');

export async function startRecording(callControlId: string): Promise<void> {
  try {
    await telnyxStartRecording(callControlId);
    log.info('Recording started', { callControlId: callControlId.slice(-12) });
  } catch (err) {
    log.error('Failed to start recording', err, { callControlId: callControlId.slice(-12) });
  }
}

export async function handleRecordingWebhook(params: {
  telnyxRecordingId: string;
  callControlId: string;
  downloadUrl: string;
  durationMs: number;
}): Promise<void> {
  const call = await prisma.call.findFirst({
    where: { callControlId: params.callControlId },
    include: { agent: { select: { id: true, userId: true } } },
  });

  if (!call) {
    log.warn('Recording webhook: call not found', { callControlId: params.callControlId.slice(-12) });
    return;
  }

  if (call.telnyxRecordingId) {
    log.info('Recording duplicate ignored', { telnyxRecordingId: params.telnyxRecordingId });
    return;
  }

  const durationSec = Math.round(params.durationMs / 1000);
  const totalRecordingSec = Math.ceil(durationSec / 60) * 60;

  await prisma.call.update({
    where: { id: call.id },
    data: {
      telnyxRecordingId: params.telnyxRecordingId,
      recordingStatus: 'processing',
      recordingDuration: durationSec,
    },
  });

  upsertMonthlyUsage(call.agentId, { totalRecordingSec })
    .catch((err) => log.error('Failed to upsert recording usage', err, { callId: call.id }));

  log.info('Recording webhook: queuing job', {
    callId: call.id,
    telnyxRecordingId: params.telnyxRecordingId,
    durationSec,
  });

  await recordingQueue.add(
    'process',
    {
      callId: call.id,
      agentId: call.agentId,
      userId: call.agent.userId,
      telnyxRecordingId: params.telnyxRecordingId,
      downloadUrl: params.downloadUrl,
    },
    { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  );
}
