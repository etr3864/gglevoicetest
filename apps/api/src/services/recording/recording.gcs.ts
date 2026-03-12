import { Storage } from '@google-cloud/storage';

const storage = new Storage();

function getBucket() {
  const name = process.env.GCS_RECORDING_BUCKET;
  if (!name) throw new Error('GCS_RECORDING_BUCKET not set');
  return storage.bucket(name);
}

export async function uploadRecording(buffer: Buffer, gcsPath: string): Promise<void> {
  const file = getBucket().file(gcsPath);
  await file.save(buffer, { contentType: 'audio/mpeg', resumable: false });
}

export async function getSignedUrl(gcsPath: string, download = false): Promise<string> {
  const file = getBucket().file(gcsPath);
  const expires = Date.now() + 60 * 60 * 1000;

  const [url] = await file.getSignedUrl({
    action: 'read',
    expires,
    ...(download && {
      responseDisposition: `attachment; filename="${gcsPath.split('/').pop()}"`,
    }),
  });

  return url;
}
