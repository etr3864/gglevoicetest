import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '@voice/db';
import { AppError } from '../middleware/error-handler';
import { knowledgeQueue } from '../lib/queue';
import { listDocuments, listChunks, deleteDocument, checkAgentLimits } from '../services/knowledge/knowledge.service';
import { detectDocType } from '../services/knowledge/file-parsers';

const router = Router({ mergeParams: true });

type KnowledgeParams = { agentId: string; documentId?: string };

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream', // fallback for xlsx/csv from some clients
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    const allowedExts = new Set(['pdf', 'docx', 'doc', 'txt', 'csv', 'xlsx', 'xls']);
    if (!allowedExts.has(ext)) {
      return cb(new AppError(400, 'INVALID_FILE_TYPE', `File type .${ext} is not supported`));
    }
    cb(null, true);
  },
});

// Ensure caller owns this agent
async function assertAgentOwnership(agentId: string, userId: string, role: string): Promise<void> {
  if (role === 'super_admin') return;
  const agent = await prisma.agent.findFirst({ where: { id: agentId, userId } });
  if (!agent) throw new AppError(403, 'FORBIDDEN', 'No access to this agent');
}

// GET /agents/:agentId/knowledge
router.get('/', async (req, res) => {
  const { agentId } = req.params as KnowledgeParams;
  await assertAgentOwnership(agentId, req.user!.userId, req.user!.role);
  const docs = await listDocuments(agentId);
  res.json({ data: docs });
});

// GET /agents/:agentId/knowledge/:documentId/chunks
router.get('/:documentId/chunks', async (req, res) => {
  const { agentId, documentId } = req.params as KnowledgeParams;
  await assertAgentOwnership(agentId, req.user!.userId, req.user!.role);
  const chunks = await listChunks(documentId!, agentId);
  res.json({ data: chunks });
});

// POST /agents/:agentId/knowledge — upload one or more files
router.post('/', upload.array('files'), async (req, res) => {
  const { agentId } = req.params as KnowledgeParams;
  await assertAgentOwnership(agentId, req.user!.userId, req.user!.role);

  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) throw new AppError(400, 'NO_FILES', 'No files uploaded');

  const limits = await checkAgentLimits(agentId);
  if (limits.docLimitReached) throw new AppError(429, 'DOC_LIMIT', 'Maximum document limit reached (30)');
  if (limits.chunkLimitReached) throw new AppError(429, 'CHUNK_LIMIT', 'Maximum chunk limit reached (3000)');

  const created = await Promise.all(
    files.map(async (file) => {
      const docType = detectDocType(file.originalname);
      const doc = await prisma.knowledgeDocument.create({
        data: {
          agentId,
          name: file.originalname,
          docType,
          status: 'processing',
          fileSizeBytes: file.size,
        },
      });

      await knowledgeQueue.add(
        'process',
        {
          documentId: doc.id,
          agentId,
          docType,
          fileContent: file.buffer.toString('base64'),
          filename: file.originalname,
        },
        { jobId: `knowledge-${doc.id}`, attempts: 2, backoff: { type: 'fixed', delay: 5_000 } },
      );

      return { id: doc.id, name: doc.name, docType, status: 'processing' };
    }),
  );

  res.status(202).json({ data: created });
});

// DELETE /agents/:agentId/knowledge/:documentId
router.delete('/:documentId', async (req, res) => {
  const { agentId, documentId } = req.params as KnowledgeParams;
  await assertAgentOwnership(agentId, req.user!.userId, req.user!.role);
  await deleteDocument(documentId!, agentId);
  res.json({ success: true });
});

export default router;
