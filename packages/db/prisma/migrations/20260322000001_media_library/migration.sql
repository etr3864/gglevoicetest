CREATE TABLE "media_items" (
  "id"                    TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "agent_id"              TEXT        NOT NULL,
  "media_type"            TEXT        NOT NULL,
  "name"                  TEXT        NOT NULL,
  "description"           TEXT        NOT NULL DEFAULT '',
  "caption"               TEXT,
  "gcs_path"              TEXT        NOT NULL,
  "thumbnail_path"        TEXT,
  "original_size_bytes"   INTEGER     NOT NULL DEFAULT 0,
  "file_size_bytes"       INTEGER     NOT NULL DEFAULT 0,
  "was_compressed"        BOOLEAN     NOT NULL DEFAULT false,
  "mime_type"             TEXT        NOT NULL,
  "status"                TEXT        NOT NULL DEFAULT 'processing',
  "error_msg"             TEXT,
  "embedding"             vector(768),
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "media_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_items_agent_id_fkey"
    FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE
);

CREATE INDEX "media_items_agent_id_media_type_status_idx"
  ON "media_items"("agent_id", "media_type", "status");

CREATE INDEX "media_items_embedding_hnsw_idx"
  ON "media_items"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 100);

CREATE INDEX "media_items_name_description_trgm_idx"
  ON "media_items"
  USING GIN (("name" || ' ' || "description") gin_trgm_ops);

ALTER TABLE "agents"
  ADD COLUMN "media_enabled"               BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "media_instructions"          TEXT,
  ADD COLUMN "media_analysis_instructions" TEXT;

ALTER TABLE "whatsapp_messages"
  ADD COLUMN "media_item_id" TEXT,
  ADD COLUMN "media_type"    TEXT,
  ADD COLUMN "media_name"    TEXT;

CREATE INDEX "whatsapp_messages_call_id_media_item_id_idx"
  ON "whatsapp_messages"("call_id", "media_item_id")
  WHERE "media_item_id" IS NOT NULL;

ALTER TABLE "agent_usage_monthly"
  ADD COLUMN "total_media_analysis_tokens" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "pricing_config"
  ADD COLUMN "media_analysis_per_1m" DOUBLE PRECISION NOT NULL DEFAULT 0.075;
