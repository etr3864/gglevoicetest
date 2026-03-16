import { Router, Request } from 'express';
import { AppError } from '../middleware/error-handler';
import {
  enableKnowledgeBase,
  disableKnowledgeBase,
  addDocument,
  removeDocument,
  listDocuments,
} from '../services/knowledge/knowledge.service';

type AgentReq = Request<{ agentId: string; docId?: string }>;

const router = Router({ mergeParams: true });

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/html',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

router.post('/enable', async (req: AgentReq, res) => {
  const kb = await enableKnowledgeBase(req.params.agentId);
  res.status(201).json({ data: kb });
});

router.delete('/', async (req: AgentReq, res) => {
  await disableKnowledgeBase(req.params.agentId);
  res.json({ data: { success: true } });
});

router.get('/documents', async (req: AgentReq, res) => {
  const result = await listDocuments(req.params.agentId);
  res.json({ data: result });
});

router.post('/documents', async (req: AgentReq, res) => {
  const contentType = req.headers['content-type'] ?? '';
  if (!ALLOWED_CONTENT_TYPES.has(contentType.split(';')[0].trim())) {
    throw new AppError(415, 'UNSUPPORTED_TYPE', 'Unsupported file type');
  }

  const fileName = (req.headers['x-file-name'] as string)?.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  if (!fileName) throw new AppError(400, 'MISSING_FILE_NAME', 'x-file-name header required');

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const buffer = Buffer.concat(chunks);

  if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new AppError(413, 'FILE_TOO_LARGE', 'Max file size is 50 MB');
  }

  const doc = await addDocument({
    agentId: req.params.agentId,
    fileName,
    fileSizeBytes: buffer.byteLength,
    buffer,
    contentType: contentType.split(';')[0].trim(),
  });

  res.status(202).json({ data: doc });
});

router.delete('/documents/:docId', async (req: AgentReq, res) => {
  await removeDocument(req.params.docId!);
  res.json({ data: { success: true } });
});

export default router;
