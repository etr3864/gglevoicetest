import { Storage } from '@google-cloud/storage';

const storage = new Storage();

function getBucket() {
  const name = process.env.GCS_KNOWLEDGE_BUCKET;
  if (!name) throw new Error('GCS_KNOWLEDGE_BUCKET not set');
  return storage.bucket(name);
}

export function buildGcsUri(agentId: string, docId: string, fileName: string): string {
  const bucket = process.env.GCS_KNOWLEDGE_BUCKET;
  if (!bucket) throw new Error('GCS_KNOWLEDGE_BUCKET not set');
  return `gs://${bucket}/agents/${agentId}/${docId}/${fileName}`;
}

export async function uploadKnowledgeFile(
  buffer: Buffer,
  agentId: string,
  docId: string,
  fileName: string,
  contentType: string,
): Promise<string> {
  const gcsPath = `agents/${agentId}/${docId}/${fileName}`;
  const file = getBucket().file(gcsPath);
  await file.save(buffer, { contentType, resumable: false });
  return buildGcsUri(agentId, docId, fileName);
}

export async function deleteKnowledgeFile(gcsUri: string): Promise<void> {
  const bucket = process.env.GCS_KNOWLEDGE_BUCKET;
  if (!bucket) return;
  const prefix = `gs://${bucket}/`;
  if (!gcsUri.startsWith(prefix)) return;
  const gcsPath = gcsUri.slice(prefix.length);
  await getBucket().file(gcsPath).delete({ ignoreNotFound: true });
}
