import { prisma } from '@voice/db';
import { createLogger } from '../lib/logger';
import { createWorker } from '../lib/queue';
import { upsertMonthlyUsage } from '../services/usage/usage.service';
import { embedTexts } from '../services/knowledge/embedding.service';
import { compressIfNeeded } from '../services/media/media-compressor';
import { analyzeImage, analyzeDocument } from '../services/media/media-analyzer';
import { downloadMediaFile, uploadMediaFile, uploadThumbnail, deleteMediaFiles } from '../services/media/media-storage.service';
import type { MediaJobData } from '../services/media/types';

const log = createLogger('media-worker');

export function startMediaWorker() {
  const worker = createWorker<MediaJobData>(
    'media-processing',
    (job) => processJob(job.data),
    { concurrency: 3, lockDuration: 600_000 },
  );

  worker.on('failed', (job, err) => {
    log.error('Media job failed', undefined, {
      jobId: job?.id,
      mediaItemId: job?.data?.mediaItemId,
      reason: err?.message?.slice(0, 200),
    });
    if (job?.data?.mediaItemId) {
      markItemError(job.data.mediaItemId, err.message).catch(() => {});
    }
  });

  return worker;
}

async function processJob(data: MediaJobData): Promise<void> {
  if (data.jobType === 'reembed_only') {
    return reembedItem(data.mediaItemId);
  }
  return fullProcessItem(data);
}

async function fullProcessItem(data: MediaJobData): Promise<void> {
  const { mediaItemId, agentId, gcsPath, mediaType, mimeType } = data;

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { basePrompt: true, mediaAnalysisInstructions: true },
  });

  const buffer = await downloadMediaFile(gcsPath);
  const compression = await compressIfNeeded(buffer, mediaType, mimeType);

  const stillExists = await prisma.mediaItem.findUnique({ where: { id: mediaItemId }, select: { id: true } });
  if (!stillExists) return;

  let finalGcsPath = gcsPath;
  if (compression.wasCompressed) {
    const filename = gcsPath.split('/').pop()!;
    finalGcsPath = await uploadMediaFile(agentId, mediaItemId, mediaType, filename, compression.buffer);
  }

  let thumbnailPath: string | undefined;
  if (compression.thumbnailBuffer) {
    thumbnailPath = await uploadThumbnail(agentId, mediaItemId, compression.thumbnailBuffer);
  }

  const analysisCtx = {
    agentSystemPrompt: agent?.basePrompt?.slice(0, 2000) ?? '',
    analysisInstructions: agent?.mediaAnalysisInstructions,
  };

  const filename = gcsPath.split('/').pop() ?? 'file';
  const { name, description, caption, tokenCount } = await runAnalysis(
    mediaType,
    mimeType,
    compression.buffer,
    filename,
    analysisCtx,
  );

  const { vectors } = await embedTexts([`${name} ${description}`]);
  const embedding = vectors[0];
  const vecStr = embedding ? `[${embedding.join(',')}]` : null;

  const stillExistsAfterAI = await prisma.mediaItem.findUnique({ where: { id: mediaItemId }, select: { id: true } });
  if (!stillExistsAfterAI) {
    await deleteMediaFiles(finalGcsPath !== gcsPath ? finalGcsPath : '', thumbnailPath).catch(() => {});
    return;
  }

  const updateSql = vecStr
    ? `UPDATE media_items SET name=$1, description=$2, caption=$3, gcs_path=$4, thumbnail_path=$5, file_size_bytes=$6, was_compressed=$7, embedding='${vecStr}'::vector, status='ready', error_msg=NULL WHERE id=$8`
    : `UPDATE media_items SET name=$1, description=$2, caption=$3, gcs_path=$4, thumbnail_path=$5, file_size_bytes=$6, was_compressed=$7, status='ready', error_msg=NULL WHERE id=$8`;

  await prisma.$executeRawUnsafe(
    updateSql,
    name,
    description,
    caption || null,
    finalGcsPath,
    thumbnailPath ?? null,
    compression.finalSize,
    compression.wasCompressed,
    mediaItemId,
  );

  if (tokenCount > 0) {
    upsertMonthlyUsage(agentId, { totalMediaAnalysisTokens: tokenCount }).catch(() => {});
  }
}

async function reembedItem(mediaItemId: string): Promise<void> {
  const item = await prisma.mediaItem.findUnique({
    where: { id: mediaItemId },
    select: { agentId: true, name: true, description: true },
  });
  if (!item) return;

  const { vectors } = await embedTexts([`${item.name} ${item.description}`]);
  const embedding = vectors[0];
  if (!embedding) return;

  const vecStr = `[${embedding.join(',')}]`;
  await prisma.$executeRawUnsafe(
    `UPDATE media_items SET embedding='${vecStr}'::vector WHERE id=$1`,
    mediaItemId,
  );
}

async function runAnalysis(
  mediaType: string,
  mimeType: string,
  buffer: Buffer,
  filename: string,
  context: { agentSystemPrompt: string; analysisInstructions?: string | null },
) {
  if (mediaType === 'video') {
    return { name: filename.replace(/\.[^.]+$/, ''), description: '', caption: '', tokenCount: 0 };
  }

  if (mediaType === 'image') {
    return analyzeImage(buffer, mimeType, context, filename);
  }

  const text = await extractDocumentText(buffer, filename);
  return analyzeDocument(text, context, filename);
}

async function extractDocumentText(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const { parsePdf, parseDocx, parseTxt } = await import('../services/knowledge/file-parsers');

  if (ext === 'pdf') return parsePdf(buffer).catch(() => '');
  if (ext === 'docx' || ext === 'doc') return parseDocx(buffer).catch(() => '');
  return parseTxt(buffer);
}

async function markItemError(mediaItemId: string, errorMsg: string): Promise<void> {
  await prisma.mediaItem
    .update({
      where: { id: mediaItemId },
      data: { status: 'error', errorMsg: errorMsg.slice(0, 500) },
    })
    .catch(() => {});
}
