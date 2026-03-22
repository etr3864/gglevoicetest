import { Storage } from '@google-cloud/storage';
import { createLogger } from '../../lib/logger';

const log = createLogger('knowledge:storage');
const storage = new Storage();

function getBucket() {
  const name = process.env.GCS_KNOWLEDGE_BUCKET;
  if (!name) throw new Error('GCS_KNOWLEDGE_BUCKET not set');
  return storage.bucket(name);
}

function buildPath(agentId: string, documentId: string, filename: string): string {
  return `agents/${agentId}/documents/${documentId}/${filename}`;
}

export async function uploadToGcs(agentId: string, documentId: string, filename: string, buffer: Buffer): Promise<string> {
  const gcsPath = buildPath(agentId, documentId, filename);
  const file = getBucket().file(gcsPath);
  await file.save(buffer, { resumable: false });
  return gcsPath;
}

export async function downloadFromGcs(agentId: string, documentId: string, filename: string): Promise<Buffer> {
  const gcsPath = buildPath(agentId, documentId, filename);
  const [buffer] = await getBucket().file(gcsPath).download();
  return buffer;
}

export async function deleteDocumentFiles(agentId: string, documentId: string): Promise<void> {
  const prefix = `agents/${agentId}/documents/${documentId}/`;
  try {
    await getBucket().deleteFiles({ prefix, force: true });
  } catch (err) {
    log.warn('GCS cleanup failed (non-fatal)', { agentId, documentId, err: String(err) });
  }
}
