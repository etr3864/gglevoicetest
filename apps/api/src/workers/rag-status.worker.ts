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

export function startRagStatusWorker() {
  const worker = createWorker<{ docId: string }>(
    'rag-status',
    (job) => processOperation(job.data.docId),
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
