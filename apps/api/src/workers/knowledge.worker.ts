import { randomUUID } from 'crypto';
import { prisma } from '@voice/db';
import { createLogger } from '../lib/logger';
import { createWorker } from '../lib/queue';
import { publishCallEvent } from '../services/events/pubsub';
import { upsertMonthlyUsage } from '../services/usage/usage.service';
import { embedTexts } from '../services/knowledge/embedding.service';
import { processTextFile, processTableFile } from '../services/knowledge/document-processor';
import { insertChunks } from '../services/knowledge/knowledge.service';
import { downloadFromGcs } from '../services/knowledge/storage.service';
import type { ChunkDraft, ChunkWithEmbedding } from '../services/knowledge/types';

const log = createLogger('knowledge-worker');

export interface KnowledgeJobData {
  documentId: string;
  agentId: string;
  docType: 'text' | 'table';
  filename: string;
}

export function startKnowledgeWorker() {
  const worker = createWorker<KnowledgeJobData>(
    'knowledge-processing',
    processDocument,
    { concurrency: 5, lockDuration: 600_000 },
  );

  worker.on('failed', (job, err) => {
    log.error('Knowledge job failed', undefined, {
      jobId: job?.id,
      documentId: job?.data?.documentId,
      reason: err?.message?.slice(0, 200),
    });
    if (job?.data?.documentId) {
      markDocumentError(job.data.documentId, err.message, job.data.agentId).catch(() => {});
    }
  });

  return worker;
}

async function processDocument(job: { data: KnowledgeJobData }): Promise<void> {
  const { documentId, agentId, docType, filename } = job.data;

  log.info('Processing knowledge document', { documentId, docType, filename });

  const buffer = await downloadFromGcs(agentId, documentId, filename);
  const chunks = await buildChunks(docType, buffer, filename);

  if (chunks.length === 0) {
    await markDocumentError(documentId, 'No chunks produced from document', agentId);
    return;
  }

  const chunksWithIds = assignIds(chunks, documentId, agentId);

  // Embed only child chunks — summaries and parents are never searched by vector
  const childIndices = new Set(
    chunksWithIds.map((c, i) => (c.chunkType === 'child' ? i : -1)).filter((i) => i >= 0),
  );
  const textsToEmbed = chunksWithIds.filter((_, i) => childIndices.has(i)).map((c) => c.content);

  const { vectors, tokenCount } = await embedTexts(textsToEmbed);

  let vecIdx = 0;
  const finalChunks: ChunkWithEmbedding[] = chunksWithIds.map((c, i) => ({
    ...c,
    embedding: childIndices.has(i) ? (vectors[vecIdx++] ?? null) : null,
  }));

  await insertChunks(finalChunks);

  await prisma.knowledgeDocument.update({
    where: { id: documentId },
    data: { status: 'ready', chunkCount: finalChunks.length },
  });

  await publishCallEvent(agentId, 'knowledge_updated', {});

  if (tokenCount > 0) {
    upsertMonthlyUsage(agentId, { totalEmbeddingTokens: tokenCount })
      .catch((err) => log.error('Failed to track embedding tokens', err, { documentId }));
  }

  log.info('Document processed', { documentId, chunks: finalChunks.length, embeddedChunks: textsToEmbed.length, tokens: tokenCount });
}

async function buildChunks(docType: 'text' | 'table', buffer: Buffer, filename: string): Promise<ChunkDraft[]> {
  if (docType === 'table') {
    const { parseCsv, parseXlsx } = await import('../services/knowledge/file-parsers');
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const table = ext === 'csv' ? await parseCsv(buffer) : parseXlsx(buffer);
    return processTableFile(table, filename);
  }

  const { parsePdf, parseDocx, parseTxt } = await import('../services/knowledge/file-parsers');
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  let text: string;
  if (ext === 'pdf') text = await parsePdf(buffer);
  else if (ext === 'docx' || ext === 'doc') text = await parseDocx(buffer);
  else text = parseTxt(buffer);

  return processTextFile(text, filename);
}

function assignIds(chunks: ChunkDraft[], documentId: string, agentId: string): ChunkWithEmbedding[] {
  const parentUuids: string[] = [];
  for (const chunk of chunks) {
    if (chunk.chunkType === 'parent') {
      parentUuids[chunk.parentIndex!] = randomUUID();
    }
  }

  return chunks.map((chunk) => ({
    ...chunk,
    id: randomUUID(),
    documentId,
    agentId,
    parentId: chunk.parentIndex !== null && chunk.chunkType === 'child'
      ? (parentUuids[chunk.parentIndex] ?? null)
      : null,
    embedding: null,
  }));
}

async function markDocumentError(documentId: string, errorMsg: string, agentId?: string): Promise<void> {
  await prisma.knowledgeDocument.update({
    where: { id: documentId },
    data: { status: 'error', errorMsg: errorMsg.slice(0, 500) },
  }).catch(() => {});
  if (agentId) await publishCallEvent(agentId, 'knowledge_updated', {}).catch(() => {});
}
