import { Storage } from '@google-cloud/storage';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const storage = new Storage();

function getBucket() {
  const name = process.env.GCS_RECORDING_BUCKET;
  if (!name) throw new Error('GCS_RECORDING_BUCKET not set');
  return storage.bucket(name);
}

export async function uploadRecordingStream(
  source: Readable,
  gcsPath: string,
): Promise<void> {
  const file = getBucket().file(gcsPath);
  const writeStream = file.createWriteStream({
    contentType: 'audio/mpeg',
    resumable: false,
  });

  await pipeline(source, writeStream);
}
