CREATE TABLE "knowledge_bases" (
  "id"               TEXT NOT NULL,
  "agent_id"         TEXT NOT NULL,
  "vertex_corpus_id" TEXT NOT NULL,
  "total_files"      INTEGER NOT NULL DEFAULT 0,
  "total_size_bytes" BIGINT NOT NULL DEFAULT 0,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_documents" (
  "id"                 TEXT NOT NULL,
  "knowledge_base_id"  TEXT NOT NULL,
  "file_name"          TEXT NOT NULL,
  "file_size_bytes"    BIGINT NOT NULL,
  "gcs_uri"            TEXT NOT NULL,
  "vertex_file_id"     TEXT,
  "vertex_operation_id" TEXT,
  "status"             TEXT NOT NULL DEFAULT 'processing',
  "error_message"      TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "knowledge_bases_agent_id_key" ON "knowledge_bases"("agent_id");
CREATE INDEX "knowledge_documents_knowledge_base_id_status_idx" ON "knowledge_documents"("knowledge_base_id", "status");
CREATE INDEX "knowledge_documents_vertex_operation_id_idx" ON "knowledge_documents"("vertex_operation_id");

ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_knowledge_base_id_fkey"
  FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
