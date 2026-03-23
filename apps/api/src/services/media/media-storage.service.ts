import { Storage } from '@google-cloud/storage';
import { createLogger } from '../../lib/logger';

const log = createLogger('media:storage');
const storage = new Storage();

function getBucket() {
  const name = process.env.GCS_MEDIA_BUCKET;
  if (!name) throw new Error('GCS_MEDIA_BUCKET not set');
  return storage.bucket(name);
}

export function buildMediaPath(agentId: string, itemId: string, mediaType: string, filename: string): string {
  return `agents/${agentId}/${mediaType}/${itemId}/${filename}`;
}

export function buildThumbnailPath(agentId: string, itemId: string): string {
  return `agents/${agentId}/video/${itemId}/thumb.jpg`;
}

export async function uploadMediaFile(
  agentId: string,
  itemId: string,
  mediaType: string,
  filename: string,
  buffer: Buffer,
): Promise<string> {
  const gcsPath = buildMediaPath(agentId, itemId, mediaType, filename);
  await getBucket().file(gcsPath).save(buffer, { resumable: false });
  return gcsPath;
}

export async function uploadThumbnail(agentId: string, itemId: string, buffer: Buffer): Promise<string> {
  const thumbnailPath = buildThumbnailPath(agentId, itemId);
  await getBucket().file(thumbnailPath).save(buffer, { resumable: false, contentType: 'image/jpeg' });
  return thumbnailPath;
}

export async function downloadMediaFile(gcsPath: string): Promise<Buffer> {
  const [buffer] = await getBucket().file(gcsPath).download();
  return buffer;
}

export async function getSignedUrl(gcsPath: string, ttlMinutes = 15): Promise<string> {
  const expires = Date.now() + ttlMinutes * 60 * 1000;
  const [url] = await getBucket().file(gcsPath).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires,
  });
  return url;
}

export async function deleteMediaFiles(gcsPath: string, thumbnailPath?: string | null): Promise<void> {
  const paths = [gcsPath, thumbnailPath].filter((p): p is string => !!p);
  await Promise.allSettled(
    paths.map((p) =>
      getBucket()
        .file(p)
        .delete()
        .catch((err) => log.warn('GCS delete failed (non-fatal)', { path: p, err: String(err) })),
    ),
  );
}
