import { Readable } from 'stream';
import { prisma } from '@voice/db';
import { createLogger } from '../../../lib/logger';
import { createWorker } from '../../../lib/queue';
import { summaryQueue } from '../../../lib/queue';
import { publishCallEvent } from '../../events/pubsub';
import { getConversation, downloadConversationAudio } from './api-client';
import type { TranscriptEntry } from './api-client';
import { uploadRecordingStream } from './recording-stream';

const log = createLogger('elevenlabs:post-call');

interface PostCallJob {
  conversationId: string;
  externalAgentId?: string;
}

export function startElevenLabsPostCallWorker() {
  const worker = createWorker<PostCallJob>(
    'elevenlabs-post-call',
    processJob,
    { concurrency: 3 },
  );

  worker.on('failed', (job, err) => {
    log.error('Post-call sync failed', undefined, {
      jobId: job?.id,
      conversationId: job?.data?.conversationId,
      attempt: job?.attemptsMade,
      reason: err?.message?.slice(0, 150),
    });
  });

  return worker;
}

async function processJob(job: { data: PostCallJob; attemptsMade: number }): Promise<void> {
  const { conversationId } = job.data;

  const call = await prisma.call.findUnique({
    where: { externalConversationId: conversationId },
    select: { id: true, agentId: true, status: true },
  });

  if (!call) {
    log.warn('No call found for conversation', { conversationId });
    return;
  }

  const conversation = await getConversation(conversationId);

  await syncTranscript(call.id, conversation.transcript ?? []);
  await syncRecording(call.id, call.agentId, conversationId);
  await finalizeCall(call.id, call.agentId, conversation);
}

async function syncTranscript(callId: string, transcript: TranscriptEntry[]): Promise<void> {
  if (transcript.length === 0) return;

  await prisma.utterance.deleteMany({ where: { callId } });

  await prisma.utterance.createMany({
    data: transcript.map((entry) => ({
      callId,
      speaker: entry.role === 'agent' ? 'agent' : 'customer',
      text: entry.message,
      startMs: Math.round(entry.time_in_call_secs * 1000),
      endMs: Math.round(entry.time_in_call_secs * 1000) + 500,
    })),
  });

  log.info('Transcript synced', { callId, utterances: transcript.length });
}

async function syncRecording(callId: string, agentId: string, conversationId: string): Promise<void> {
  try {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { userId: true },
    });

    const month = new Date().toISOString().slice(0, 7);
    const gcsPath = `recordings/${agent?.userId ?? 'unknown'}/${agentId}/${month}/${callId}.mp3`;

    const audioRes = await downloadConversationAudio(conversationId);
    if (!audioRes.body) throw new Error('No audio body');

    const nodeStream = Readable.fromWeb(audioRes.body as any);
    await uploadRecordingStream(nodeStream, gcsPath);

    await prisma.call.update({
      where: { id: callId },
      data: {
        recordingUrl: gcsPath,
        recordingStatus: 'ready',
      },
    });

    await publishCallEvent(agentId, 'recording_ready', {
      call: { id: callId, recordingStatus: 'ready', recordingUrl: gcsPath },
    });

    log.info('Recording uploaded', { callId, gcsPath });
  } catch (err) {
    log.error('Recording sync failed (non-blocking)', err, { callId });
    await prisma.call.update({
      where: { id: callId },
      data: { recordingStatus: 'failed' },
    }).catch(() => {});
  }
}

async function finalizeCall(
  callId: string,
  agentId: string,
  conversation: Awaited<ReturnType<typeof getConversation>>,
): Promise<void> {
  const cost = conversation.metadata?.cost
    ? parseFloat(conversation.metadata.cost)
    : undefined;

  await prisma.call.update({
    where: { id: callId },
    data: {
      status: 'completed',
      endedAt: new Date(),
      ...(cost !== undefined && !isNaN(cost) && { externalProviderCost: cost }),
    },
  });

  await publishCallEvent(agentId, 'call_ended', {
    call: { id: callId, status: 'completed' },
  });

  await summaryQueue
    .add('generate', { callId }, {
      jobId: `summary-${callId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    })
    .catch((err) => log.error('Failed to enqueue summary', err, { callId }));

  log.info('Call finalized', { callId });
}
