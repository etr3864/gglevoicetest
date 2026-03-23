import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { prisma } from '@voice/db';
import { AppError } from '../middleware/error-handler';
import { mediaQueue } from '../lib/queue';
import { uploadMediaFile, getSignedUrl, deleteMediaFiles } from '../services/media/media-storage.service';
import type { MediaType } from '../services/media/types';

const router = Router({ mergeParams: true });

type Params = { agentId: string; itemId?: string };

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm']);
const FILE_EXTS  = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt']);

const SIZE_LIMITS: Record<string, number> = {
  image:  10 * 1024 * 1024,
  video: 500 * 1024 * 1024,
  file:   25 * 1024 * 1024,
};

function detectMediaType(filename: string): MediaType | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (FILE_EXTS.has(ext)) return 'file';
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024, files: 30 },
  fileFilter: (_req, file, cb) => {
    if (!detectMediaType(file.originalname)) {
      return cb(new AppError(400, 'INVALID_FILE_TYPE', `Unsupported file type: ${file.originalname}`));
    }
    cb(null, true);
  },
});

function handleUpload(req: any, res: any, next: any) {
  upload.array('files')(req, res, (err: any) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError(400, 'FILE_TOO_LARGE', 'הקובץ גדול מדי (מקסימום 500MB לסרטון, 10MB לתמונה, 25MB לקובץ)'));
    }
    if (err) return next(err);
    next();
  });
}

function assertSuperAdmin(req: Express.Request): void {
  if (req.user?.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Super admin only');
}

async function validateMimeType(buffer: Buffer, expectedType: MediaType): Promise<string> {
  const fileTypeModule = await import('file-type');
  const fromBuffer = (fileTypeModule as any).fromBuffer ?? (fileTypeModule as any).fileTypeFromBuffer;
  const detected = fromBuffer ? await fromBuffer(buffer) : null;
  const mime = detected?.mime ?? 'application/octet-stream';

  if (expectedType === 'image' && !mime.startsWith('image/')) {
    throw new AppError(400, 'INVALID_FILE', 'File content does not match image type');
  }
  if (expectedType === 'video' && !mime.startsWith('video/')) {
    throw new AppError(400, 'INVALID_FILE', 'File content does not match video type');
  }

  return mime;
}

// GET /agents/:agentId/media/counts
router.get('/counts', async (req, res) => {
  assertSuperAdmin(req as any);
  const { agentId } = req.params as Params;
  const [image, video, file] = await Promise.all([
    prisma.mediaItem.count({ where: { agentId, mediaType: 'image' } }),
    prisma.mediaItem.count({ where: { agentId, mediaType: 'video' } }),
    prisma.mediaItem.count({ where: { agentId, mediaType: 'file' } }),
  ]);
  res.json({ data: { image, video, file } });
});

// GET /agents/:agentId/media?type=image|video|file
router.get('/', async (req, res) => {
  assertSuperAdmin(req as any);
  const { agentId } = req.params as Params;
  const mediaType = req.query.type as string | undefined;

  const items = await prisma.mediaItem.findMany({
    where: {
      agentId,
      ...(mediaType ? { mediaType } : {}),
    },
    select: {
      id: true, mediaType: true, name: true, description: true, caption: true,
      gcsPath: true, thumbnailPath: true, fileSizeBytes: true, originalSizeBytes: true,
      wasCompressed: true, mimeType: true, status: true, errorMsg: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const enriched = await Promise.all(
    items.map(async (item: typeof items[number]) => {
      const previewUrl = item.status === 'ready'
        ? await getSignedUrl(item.gcsPath).catch(() => null)
        : null;
      const thumbnailUrl = item.thumbnailPath && item.status === 'ready'
        ? await getSignedUrl(item.thumbnailPath).catch(() => null)
        : null;
      return { ...item, previewUrl, thumbnailUrl };
    }),
  );

  res.json({ data: enriched });
});

// POST /agents/:agentId/media — upload files
router.post('/', handleUpload, async (req, res) => {
  assertSuperAdmin(req as any);
  const { agentId } = req.params as Params;

  const files = req.files as Express.Multer.File[];
  if (!files?.length) throw new AppError(400, 'NO_FILES', 'No files uploaded');

  const created = await Promise.all(
    files.map(async (file) => {
      const mediaType = detectMediaType(file.originalname)!;

      const sizeLimit = SIZE_LIMITS[mediaType];
      if (file.size > sizeLimit) {
        throw new AppError(400, 'FILE_TOO_LARGE', `${file.originalname} exceeds ${sizeLimit / 1024 / 1024}MB limit`);
      }

      const mimeType = await validateMimeType(file.buffer, mediaType);

      const itemId = randomUUID();
      const gcsPath = await uploadMediaFile(agentId, itemId, mediaType, file.originalname, file.buffer);

      const item = await prisma.mediaItem.create({
        data: {
          id: itemId,
          agentId,
          mediaType,
          name: file.originalname.replace(/\.[^.]+$/, ''),
          mimeType,
          gcsPath,
          originalSizeBytes: file.size,
          fileSizeBytes: file.size,
          status: 'processing',
        },
      });

      await mediaQueue.add(
        'process',
        { mediaItemId: item.id, agentId, gcsPath, mediaType, mimeType, jobType: 'full_process' },
        { jobId: item.id, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 500, removeOnFail: 200 },
      );

      return item;
    }),
  );

  res.status(201).json({ data: created });
});

// PATCH /agents/:agentId/media/:itemId — edit metadata
router.patch('/:itemId', async (req, res) => {
  assertSuperAdmin(req as any);
  const { agentId, itemId } = req.params as Params;

  const existing = await prisma.mediaItem.findFirst({ where: { id: itemId!, agentId } });
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Media item not found');

  const { name, description, caption } = req.body as Record<string, string | undefined>;
  const descriptionChanged = description !== undefined && description !== existing.description;

  const updated = await prisma.mediaItem.update({
    where: { id: itemId! },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(caption !== undefined ? { caption: caption || null } : {}),
    },
  });

  if (descriptionChanged && existing.status === 'ready') {
    await mediaQueue.add(
      'reembed',
      { mediaItemId: itemId!, agentId, gcsPath: existing.gcsPath, mediaType: existing.mediaType as MediaType, mimeType: existing.mimeType, jobType: 'reembed_only' },
      { attempts: 2, removeOnComplete: 100 },
    );
  }

  res.json({ data: updated });
});

// GET /agents/:agentId/media/:itemId/url — fresh signed URL for preview
router.get('/:itemId/url', async (req, res) => {
  assertSuperAdmin(req as any);
  const { agentId, itemId } = req.params as Params;

  const item = await prisma.mediaItem.findFirst({
    where: { id: itemId!, agentId, status: 'ready' },
    select: { gcsPath: true, mimeType: true },
  });
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Media item not found');

  const url = await getSignedUrl(item.gcsPath, 60);
  res.json({ data: { url, mimeType: item.mimeType } });
});

// POST /agents/:agentId/media/:itemId/retry — retry failed item
router.post('/:itemId/retry', async (req, res) => {
  assertSuperAdmin(req as any);
  const { agentId, itemId } = req.params as Params;

  const item = await prisma.mediaItem.findFirst({ where: { id: itemId!, agentId, status: 'error' } });
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Error media item not found');

  await prisma.mediaItem.update({ where: { id: itemId! }, data: { status: 'processing', errorMsg: null } });

  await mediaQueue.add(
    'process',
    { mediaItemId: item.id, agentId, gcsPath: item.gcsPath, mediaType: item.mediaType as MediaType, mimeType: item.mimeType, jobType: 'full_process' },
    { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 500 },
  );

  res.json({ ok: true });
});

// DELETE /agents/:agentId/media/:itemId
router.delete('/:itemId', async (req, res) => {
  assertSuperAdmin(req as any);
  const { agentId, itemId } = req.params as Params;

  const item = await prisma.mediaItem.findFirst({ where: { id: itemId!, agentId } });
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Media item not found');

  await prisma.mediaItem.delete({ where: { id: itemId! } });
  await deleteMediaFiles(item.gcsPath, item.thumbnailPath);

  res.json({ ok: true });
});

// GET /agents/:agentId/media/settings
router.get('/settings', async (req, res) => {
  assertSuperAdmin(req as any);
  const { agentId } = req.params as Params;

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { mediaEnabled: true, mediaInstructions: true, mediaAnalysisInstructions: true },
  });
  if (!agent) throw new AppError(404, 'NOT_FOUND', 'Agent not found');

  res.json({ data: agent });
});

// PATCH /agents/:agentId/media/settings
router.patch('/settings', async (req, res) => {
  assertSuperAdmin(req as any);
  const { agentId } = req.params as Params;

  const { mediaEnabled, mediaInstructions, mediaAnalysisInstructions } = req.body as Record<string, unknown>;

  const updated = await prisma.agent.update({
    where: { id: agentId },
    data: {
      ...(mediaEnabled !== undefined ? { mediaEnabled: Boolean(mediaEnabled) } : {}),
      ...(mediaInstructions !== undefined ? { mediaInstructions: mediaInstructions as string || null } : {}),
      ...(mediaAnalysisInstructions !== undefined ? { mediaAnalysisInstructions: mediaAnalysisInstructions as string || null } : {}),
    },
    select: { mediaEnabled: true, mediaInstructions: true, mediaAnalysisInstructions: true },
  });

  res.json({ data: updated });
});

export default router;
