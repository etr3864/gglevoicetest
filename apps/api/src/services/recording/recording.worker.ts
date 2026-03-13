import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { redis } from '../../lib/redis';
import { createWorker } from '../../lib/queue';
import { publishCallEvent } from '../events/pubsub';
import { uploadRecording } from './recording.gcs';

const log = createLogger('recording-worker');

interface RecordingJob {
  callId: string;
  agentId: string;
  userId: string | null;
  telnyxRecordingId: string;
  downloadUrl: string;
}

export function startRecordingWorker() {
  const worker = createWorker<RecordingJob>('recordings', processJob, { concurrency: 5 });

  worker.on('failed', (job, err) => {
    log.error('Recording job failed', undefined, {
      jobId: job?.id,
      callId: job?.data?.callId,
      attempt: job?.attemptsMade,
      reason: err?.message?.slice(0, 150),
    });
  });

  return worker;
}

async function processJob(job: { data: RecordingJob; attemptsMade: number }): Promise<void> {
  const { callId, agentId, userId, telnyxRecordingId, downloadUrl } = job.data;

  const lockKey = `recording:lock:${telnyxRecordingId}`;
  const locked = await redis.set(lockKey, '1', 'EX', 300, 'NX');
  if (!locked) {
    log.info('Recording already being processed', { telnyxRecordingId });
    return;
  }

  try {
    log.info('Processing recording', { callId, telnyxRecordingId });

    const buffer = await downloadFromTelnyx(downloadUrl);
    log.info('Downloaded recording', { callId, bytes: buffer.length });

    const month = new Date().toISOString().slice(0, 7);
    const gcsPath = `recordings/${userId ?? 'unknown'}/${agentId}/${month}/${callId}.mp3`;

    await uploadRecording(buffer, gcsPath);
    log.info('Uploaded to GCS', { callId, path: gcsPath });

    const call = await prisma.call.update({
      where: { id: callId },
      data: {
        recordingUrl: gcsPath,
        recordingStatus: 'ready',
        recordingSizeBytes: buffer.length,
      },
    });

    await publishCallEvent(agentId, 'recording_ready', {
      call: { id: callId, recordingStatus: 'ready', recordingUrl: call.recordingUrl },
    });

    log.info('Recording ready', { callId });
  } catch (err) {
    if (job.attemptsMade >= 2) {
      await prisma.call.update({
        where: { id: callId },
        data: { recordingStatus: 'failed' },
      }).catch(() => {});
      log.error('Recording permanently failed', undefined, { callId, telnyxRecordingId });
    } else {
      log.error('Recording attempt failed', err, { callId, attempt: job.attemptsMade + 1 });
    }
    await redis.del(lockKey);
    throw err;
  }

  await redis.del(lockKey);
}

async function downloadFromTelnyx(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Telnyx download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
