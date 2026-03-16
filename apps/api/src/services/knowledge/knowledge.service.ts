import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import * as vertexRag from './vertex-rag.service';
import { uploadKnowledgeFile, deleteKnowledgeFile } from './gcs';
import { ragStatusQueue } from '../../lib/queue';

const log = createLogger('knowledge-service');

export async function enableKnowledgeBase(agentId: string) {
  const existing = await prisma.knowledgeBase.findUnique({ where: { agentId } });
  if (existing) return existing;

  const operationId = await vertexRag.createCorpus(`agent-${agentId}`);

  // Create it with a temporary placeholder corpus ID, and add to rag status queue
  // Since we don't have the final corpus ID until the operation completes
  const kb = await prisma.knowledgeBase.create({
    data: { agentId, vertexCorpusId: 'pending' },
  });

  // Since we already have a status queue for documents, let's reuse it for the corpus
  await ragStatusQueue.add('poll-corpus', { kbId: kb.id, operationId }, { delay: 5_000 });

  return kb;
}

export async function disableKnowledgeBase(agentId: string) {
  const kb = await prisma.knowledgeBase.findUnique({ where: { agentId } });
  if (!kb) return;

  if (kb.vertexCorpusId !== 'pending') {
    try {
      await vertexRag.deleteCorpus(`projects/${process.env.GCP_PROJECT_ID}/locations/${process.env.GCP_RAG_LOCATION || 'europe-west4'}/ragCorpora/${kb.vertexCorpusId}`);
    } catch (err) {
      log.warn('Failed to delete Vertex corpus — removing DB record anyway', { corpusId: kb.vertexCorpusId, err: String(err) });
    }
  }

  await prisma.knowledgeBase.delete({ where: { agentId } });
}

export interface UploadDocumentInput {
  agentId: string;
  fileName: string;
  fileSizeBytes: number;
  buffer: Buffer;
  contentType: string;
}

export async function addDocument(input: UploadDocumentInput) {
  const kb = await prisma.knowledgeBase.findUnique({ where: { agentId: input.agentId } });
  if (!kb) throw new Error('Knowledge base not enabled for this agent');
  if (kb.vertexCorpusId === 'pending') throw new Error('Knowledge base is still being created');

  const doc = await prisma.knowledgeDocument.create({
    data: {
      knowledgeBaseId: kb.id,
      fileName: input.fileName,
      fileSizeBytes: input.fileSizeBytes,
      gcsUri: '',
      status: 'processing',
    },
  });

  const gcsUri = await uploadKnowledgeFile(
    input.buffer,
    input.agentId,
    doc.id,
    input.fileName,
    input.contentType,
  );

  const corpusResourceName = `projects/${process.env.GCP_PROJECT_ID}/locations/${process.env.GCP_RAG_LOCATION || 'europe-west4'}/ragCorpora/${kb.vertexCorpusId}`;
  const { operationId } = await vertexRag.importFile(corpusResourceName, gcsUri, input.fileName);

  await prisma.knowledgeDocument.update({
    where: { id: doc.id },
    data: { gcsUri, vertexOperationId: operationId },
  });

  await ragStatusQueue.add('poll-operation', { docId: doc.id }, { delay: 5_000 });

  await prisma.knowledgeBase.update({
    where: { id: kb.id },
    data: { totalFiles: { increment: 1 }, totalSizeBytes: { increment: input.fileSizeBytes } },
  });

  return { ...doc, gcsUri, vertexOperationId: operationId };
}

export async function removeDocument(docId: string) {
  const doc = await prisma.knowledgeDocument.findUnique({
    where: { id: docId },
    include: { knowledgeBase: true },
  });
  if (!doc) throw new Error('Document not found');

  if (doc.vertexFileId) {
    try {
      await vertexRag.deleteFile(doc.vertexFileId);
    } catch (err) {
      log.warn('Failed to delete Vertex RAG file', { vertexFileId: doc.vertexFileId, err: String(err) });
    }
  }

  await deleteKnowledgeFile(doc.gcsUri);

  await prisma.$transaction([
    prisma.knowledgeDocument.delete({ where: { id: docId } }),
    prisma.knowledgeBase.update({
      where: { id: doc.knowledgeBaseId },
      data: {
        totalFiles: { decrement: 1 },
        totalSizeBytes: { decrement: doc.fileSizeBytes },
      },
    }),
  ]);
}

export async function listDocuments(agentId: string) {
  const kb = await prisma.knowledgeBase.findUnique({
    where: { agentId },
    include: { documents: { orderBy: { createdAt: 'desc' } } },
  });
  return kb ?? null;
}
