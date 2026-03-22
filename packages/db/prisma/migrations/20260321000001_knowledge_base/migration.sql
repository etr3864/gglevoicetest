-- Enable required extensions
-- NOTE: pgvector requires `cloudsql.enable_pgvector=on` flag set in Cloud SQL before this runs
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add embedding cost field to pricing config
ALTER TABLE "pricing_config" ADD COLUMN "embedding_per_1m" DOUBLE PRECISION NOT NULL DEFAULT 0.10;

-- Add embedding token tracking to usage
ALTER TABLE "agent_usage_monthly" ADD COLUMN "total_embedding_tokens" INTEGER NOT NULL DEFAULT 0;

-- Knowledge documents table
CREATE TABLE "knowledge_documents" (
  "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
  "agent_id"       UUID        NOT NULL,
  "name"           TEXT        NOT NULL,
  "doc_type"       TEXT        NOT NULL,
  "status"         TEXT        NOT NULL DEFAULT 'processing',
  "error_msg"      TEXT,
  "chunk_count"    INTEGER     NOT NULL DEFAULT 0,
  "file_size_bytes" INTEGER    NOT NULL DEFAULT 0,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_documents_agent_id_fkey"
    FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE
);

CREATE INDEX "knowledge_documents_agent_id_status_idx" ON "knowledge_documents"("agent_id", "status");

-- Knowledge chunks table
CREATE TABLE "knowledge_chunks" (
  "id"          UUID    NOT NULL DEFAULT gen_random_uuid(),
  "document_id" UUID    NOT NULL,
  "agent_id"    UUID    NOT NULL,
  "chunk_type"  TEXT    NOT NULL DEFAULT 'child',
  "parent_id"   UUID,
  "content"     TEXT    NOT NULL,
  "embedding"   vector(768),
  "importance"  FLOAT8  NOT NULL DEFAULT 0.5,
  "metadata"    JSONB,
  CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_chunks_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE
);

CREATE INDEX "knowledge_chunks_agent_id_chunk_type_idx" ON "knowledge_chunks"("agent_id", "chunk_type");
CREATE INDEX "knowledge_chunks_parent_id_idx" ON "knowledge_chunks"("parent_id");

-- GIN index for fast trigram search on Hebrew/English text
CREATE INDEX "knowledge_chunks_content_trgm_idx" ON "knowledge_chunks" USING GIN ("content" gin_trgm_ops);

-- HNSW vector index — built after data is loaded (comment out and run manually on production if needed)
-- m=16 (connectivity), ef_construction=100 (build quality), cosine distance
CREATE INDEX CONCURRENTLY IF NOT EXISTS "knowledge_chunks_embedding_hnsw_idx"
  ON "knowledge_chunks"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 100);
-- Note: text-multilingual-embedding-002 outputs 768-dim vectors (Matryoshka)
-- Pricing: $0.10 per 1M input tokens (Vertex AI, 2026)
