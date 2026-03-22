import { randomUUID } from 'crypto';
import { prisma } from '@voice/db';
import { createLogger } from '../lib/logger';
import { createWorker } from '../lib/queue';
import { upsertMonthlyUsage } from '../services/usage/usage.service';
import { embedTexts } from '../services/knowledge/embedding.service';
import { processTextFile, processTableFile } from '../services/knowledge/document-processor';
import { insertChunks } from '../services/knowledge/knowledge.service';
import type { ChunkDraft, ChunkWithEmbedding } from '../services/knowledge/types';

const log = createLogger('knowledge-worker');

export interface KnowledgeJobData {
  documentId: string;
  agentId: string;
  docType: 'text' | 'table';
  fileContent: string; // base64 for binary, utf-8 text for text
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
      markDocumentError(job.data.documentId, err.message).catch(() => {});
    }
  });

  return worker;
}

async function processDocument(job: { data: KnowledgeJobData }): Promise<void> {
  const { documentId, agentId, docType, fileContent, filename } = job.data;

  log.info('Processing knowledge document', { documentId, docType, filename });

  const buffer = Buffer.from(fileContent, 'base64');
  const chunks = await buildChunks(docType, buffer, filename);

  if (chunks.length === 0) {
    await markDocumentError(documentId, 'No chunks produced from document');
    return;
  }

  // Assign stable IDs and resolve parent UUIDs
  const chunksWithIds = assignIds(chunks, documentId, agentId);

  // Embed only chunks that need vectors (parent + child + table rows)
  const embeddableChunks = chunksWithIds.filter((c) => c.chunkType !== 'summary' || c.embedding === null);
  const textsToEmbed = chunksWithIds.map((c) => c.content);

  const { vectors, tokenCount } = await embedTexts(textsToEmbed);

  const finalChunks: ChunkWithEmbedding[] = chunksWithIds.map((c, i) => ({
    ...c,
    embedding: vectors[i] ?? null,
  }));

  await insertChunks(finalChunks);

  await prisma.knowledgeDocument.update({
    where: { id: documentId },
    data: { status: 'ready', chunkCount: finalChunks.length },
  });

  // Track embedding tokens (non-blocking)
  if (tokenCount > 0) {
    upsertMonthlyUsage(agentId, { totalEmbeddingTokens: tokenCount })
      .catch((err) => log.error('Failed to track embedding tokens', err, { documentId }));
  }

  log.info('Document processed', { documentId, chunks: finalChunks.length, tokens: tokenCount });
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
  // First pass: assign UUIDs to parent chunks so children can reference them
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

async function markDocumentError(documentId: string, errorMsg: string): Promise<void> {
  await prisma.knowledgeDocument.update({
    where: { id: documentId },
    data: { status: 'error', errorMsg: errorMsg.slice(0, 500) },
  }).catch(() => {});
}
