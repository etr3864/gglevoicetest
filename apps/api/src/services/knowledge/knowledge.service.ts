import { prisma, Prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import { embedQuery } from './embedding.service';
import { deleteDocumentFiles } from './storage.service';
import type { SearchResult, KnowledgeMeta, WarmupContext, ChunkWithEmbedding } from './types';

const log = createLogger('knowledge:service');

const MAX_DOCS_PER_AGENT   = 30;
const MAX_CHUNKS_PER_AGENT = 3_000;
const SEARCH_CANDIDATES    = 20;
const SEARCH_TOP_K         = 8;
const WARMUP_SUMMARY_LIMIT  = 3;
const WARMUP_CHILDREN_LIMIT = 3;

// ─── Search ──────────────────────────────────────────────────────────────────

export async function searchKnowledge(agentId: string, query: string): Promise<SearchResult[]> {
  const { vector } = await embedQuery(query);
  return runTwoPhaseSearch(agentId, vector, query);
}

export async function queryTable(agentId: string, query: string): Promise<SearchResult[]> {
  const { vector } = await embedQuery(query);
  return runTwoPhaseSearch(agentId, vector, query, true);
}

async function runTwoPhaseSearch(
  agentId: string,
  queryVec: number[],
  queryText: string,
  tableOnly = false,
): Promise<SearchResult[]> {
  const vecStr = `[${queryVec.join(',')}]`;

  type RawRow = { id: string; content: string; parent_id: string | null; chunk_type: string; metadata: unknown; cosine: number };

  // Enable iterative scan so HNSW index respects WHERE filters efficiently
  // Phase 1: HNSW index scan → Phase 2: re-score with trigram similarity
  const candidates = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL hnsw.iterative_scan = relaxed_order`;
    return tx.$queryRaw<RawRow[]>`
      WITH candidates AS (
        SELECT
          kc.id, kc.content, kc.parent_id, kc.chunk_type, kc.metadata,
          1 - (kc.embedding <=> ${vecStr}::vector) AS cosine
        FROM knowledge_chunks kc
        JOIN knowledge_documents kd ON kd.id = kc.document_id
        WHERE kc.agent_id = ${agentId}
          AND kc.chunk_type = 'child'
          ${tableOnly ? Prisma.sql`AND kd.doc_type = 'table'` : Prisma.sql``}
          AND kc.embedding IS NOT NULL
        ORDER BY kc.embedding <=> ${vecStr}::vector
        LIMIT ${SEARCH_CANDIDATES}
      )
      SELECT
        c.*,
        (0.7 * c.cosine + 0.3 * similarity(c.content, ${queryText})) AS final_score
      FROM candidates c
      ORDER BY final_score DESC
      LIMIT ${SEARCH_TOP_K}
    `;
  });

  if (!candidates || candidates.length === 0) return [];

  // Dedupe by parent_id — keep highest-scoring child per parent
  const seen = new Set<string>();
  const deduped: RawRow[] = [];
  for (const row of candidates) {
    const key = row.parent_id ?? row.id;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(row);
    }
  }

  // Fetch parent content for context enrichment
  const parentIds = deduped.map((r) => r.parent_id).filter((id): id is string => id !== null);
  const parents = parentIds.length > 0
    ? await prisma.$queryRaw<{ id: string; content: string }[]>`
        SELECT id, content FROM knowledge_chunks WHERE id = ANY(${parentIds}::text[])
      `
    : [];
  const parentMap = new Map(parents.map((p) => [p.id, p.content]));

  return deduped.map((row) => ({
    content: (row.parent_id ? parentMap.get(row.parent_id) : null) ?? row.content,
    score: row.cosine,
    chunkType: row.chunk_type as SearchResult['chunkType'],
    metadata: (row.metadata as Record<string, unknown>) ?? null,
  }));
}

// ─── Warmup context ──────────────────────────────────────────────────────────

export async function getWarmupContext(agentId: string): Promise<WarmupContext> {
  const meta = await getKnowledgeMeta(agentId);

  if (!meta.hasTextDocs && !meta.hasTables) {
    return { promptSection: '', meta };
  }

  const [summaries, topChildren, docNames] = await Promise.all([
    prisma.$queryRaw<{ content: string }[]>`
      SELECT content FROM knowledge_chunks
      WHERE agent_id = ${agentId} AND chunk_type = 'summary'
      ORDER BY importance DESC
      LIMIT ${WARMUP_SUMMARY_LIMIT}
    `,
    prisma.$queryRaw<{ content: string }[]>`
      SELECT content FROM knowledge_chunks
      WHERE agent_id = ${agentId} AND chunk_type = 'child'
      ORDER BY importance DESC
      LIMIT ${WARMUP_CHILDREN_LIMIT}
    `,
    prisma.$queryRaw<{ name: string }[]>`
      SELECT name FROM knowledge_documents
      WHERE agent_id = ${agentId} AND status = 'ready'
      ORDER BY created_at DESC
    `,
  ]);

  const docList = docNames.map((d) => d.name).join(', ');
  const summaryTexts = summaries.map((s) => s.content).join('\n\n');
  const childTexts = topChildren.map((c) => c.content).join('\n');

  const lines: string[] = [
    '## Knowledge Base',
    `Available documents: ${docList}`,
    '',
    '### Document summaries:',
    summaryTexts,
  ];

  if (childTexts) {
    lines.push('', '### Key facts:', childTexts);
  }

  return { promptSection: lines.join('\n'), meta };
}

// ─── Meta / limits ───────────────────────────────────────────────────────────

export async function getKnowledgeMeta(agentId: string): Promise<KnowledgeMeta> {
  const rows = await prisma.$queryRaw<{ doc_type: string; cnt: bigint }[]>`
    SELECT doc_type, COUNT(*) as cnt
    FROM knowledge_documents
    WHERE agent_id = ${agentId} AND status = 'ready'
    GROUP BY doc_type
  `;

  const counts = Object.fromEntries(rows.map((r) => [r.doc_type, Number(r.cnt)]));
  return {
    hasTextDocs: (counts['text'] ?? 0) > 0,
    hasTables:   (counts['table'] ?? 0) > 0,
  };
}

export async function checkAgentLimits(agentId: string): Promise<{
  docLimitReached: boolean;
  chunkLimitReached: boolean;
  currentDocCount: number;
}> {
  const [docCount, chunkCount] = await Promise.all([
    prisma.knowledgeDocument.count({ where: { agentId, status: { not: 'error' } } }),
    prisma.$queryRaw<[{ cnt: bigint }]>`
      SELECT COUNT(*) as cnt FROM knowledge_chunks WHERE agent_id = ${agentId}
    `,
  ]);
  return {
    docLimitReached:   docCount >= MAX_DOCS_PER_AGENT,
    chunkLimitReached: Number(chunkCount[0].cnt) >= MAX_CHUNKS_PER_AGENT,
    currentDocCount:   docCount,
  };
}

// ─── Write ───────────────────────────────────────────────────────────────────

const BULK_INSERT_SIZE = 50;

export async function insertChunks(chunks: ChunkWithEmbedding[]): Promise<void> {
  for (let i = 0; i < chunks.length; i += BULK_INSERT_SIZE) {
    const batch = chunks.slice(i, i + BULK_INSERT_SIZE);
    await bulkInsertBatch(batch);
  }
}

async function bulkInsertBatch(batch: ChunkWithEmbedding[]): Promise<void> {
  if (batch.length === 0) return;

  // Content is the only user-controlled field — parameterized via $1, $2...
  // All other fields are system-generated (UUIDs, enums, embeddings from Vertex AI)
  const contentParams = batch.map((c) => c.content);
  const placeholders = batch.map((c, i) => {
    const vec = c.embedding ? `'[${c.embedding.join(',')}]'::vector` : 'NULL';
    const meta = c.metadata ? `'${JSON.stringify(c.metadata).replace(/'/g, "''")}'::jsonb` : 'NULL';
    const pid = c.parentId ? `'${c.parentId}'` : 'NULL';
    return `('${c.id}', '${c.documentId}', '${c.agentId}', '${c.chunkType}', ${pid}, $${i + 1}, ${vec}, ${c.importance}, ${meta})`;
  });

  const sql = `INSERT INTO knowledge_chunks (id, document_id, agent_id, chunk_type, parent_id, content, embedding, importance, metadata) VALUES ${placeholders.join(', ')}`;
  await prisma.$executeRawUnsafe(sql, ...contentParams);
}

export async function deleteDocument(documentId: string, agentId: string): Promise<void> {
  const doc = await prisma.knowledgeDocument.findFirst({
    where: { id: documentId, agentId },
    select: { name: true },
  });
  if (!doc) return;

  await prisma.knowledgeDocument.deleteMany({ where: { id: documentId, agentId } });
  await deleteDocumentFiles(agentId, documentId);
  log.info('Document deleted', { documentId, agentId });
}

export async function listDocuments(agentId: string) {
  return prisma.knowledgeDocument.findMany({
    where: { agentId },
    select: { id: true, name: true, docType: true, status: true, errorMsg: true, chunkCount: true, fileSizeBytes: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listChunks(documentId: string, agentId: string) {
  return prisma.$queryRaw<{ id: string; chunk_type: string; content: string; importance: number }[]>`
    SELECT id, chunk_type, LEFT(content, 300) AS content, importance
    FROM knowledge_chunks
    WHERE document_id = ${documentId} AND agent_id = ${agentId}
    ORDER BY chunk_type, importance DESC
    LIMIT 200
  `;
}
