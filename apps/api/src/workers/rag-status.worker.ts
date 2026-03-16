import { prisma } from '@voice/db';
import { createLogger } from '../lib/logger';
import { createWorker, ragStatusQueue } from '../lib/queue';
import { pollOperation } from '../services/knowledge/vertex-rag.service';

const log = createLogger('rag-status-worker');

const MAX_ATTEMPTS = 20;
const RETRY_DELAY_MS = 15_000;

async function processOperation(docId: string): Promise<void> {
  const doc = await prisma.knowledgeDocument.findUnique({ where: { id: docId } });
  if (!doc || !doc.vertexOperationId) return;
  if (doc.status === 'ready' || doc.status === 'failed') return;

  const status = await pollOperation(doc.vertexOperationId);

  if (!status.done) {
    await ragStatusQueue.add('poll-operation', { docId }, { delay: RETRY_DELAY_MS });
    return;
  }

  if (status.error) {
    await prisma.knowledgeDocument.update({
      where: { id: docId },
      data: { status: 'failed', errorMessage: status.error.message },
    });
    return;
  }

  await prisma.knowledgeDocument.update({
    where: { id: docId },
    data: { status: 'ready', errorMessage: null },
  });
}

async function processCorpusOperation(kbId: string, operationId: string): Promise<void> {
  const kb = await prisma.knowledgeBase.findUnique({ where: { id: kbId } });
  if (!kb || kb.vertexCorpusId !== 'pending') return;

  const status = await pollOperation(operationId);

  if (!status.done) {
    await ragStatusQueue.add('poll-corpus', { kbId, operationId }, { delay: RETRY_DELAY_MS });
    return;
  }

  if (status.error) {
    log.error('Failed to create corpus', undefined, { kbId, error: status.error.message });
    await prisma.knowledgeBase.delete({ where: { id: kbId } });
    return;
  }

  // extract corpus ID from the response name
  const response = status.response as { name: string };
  const [, corpusId] = response.name.split('/ragCorpora/');

  await prisma.knowledgeBase.update({
    where: { id: kbId },
    data: { vertexCorpusId: corpusId },
  });
}

export function startRagStatusWorker() {
  const worker = createWorker<{ docId?: string; kbId?: string; operationId?: string }>(
    'rag-status',
    async (job) => {
      if (job.name === 'poll-corpus' && job.data.kbId && job.data.operationId) {
        await processCorpusOperation(job.data.kbId, job.data.operationId);
      } else if (job.data.docId) {
        await processOperation(job.data.docId);
      }
    },
    { concurrency: 5 },
  );

  worker.on('failed', (job, err) => {
    const attempts = job?.attemptsMade ?? 0;
    if (attempts >= MAX_ATTEMPTS) {
      log.error('RAG status poll exceeded max attempts', undefined, { docId: job?.data?.docId });
      return;
    }
    log.warn('RAG status poll failed', { docId: job?.data?.docId, err: err?.message });
  });

  return worker;
}
