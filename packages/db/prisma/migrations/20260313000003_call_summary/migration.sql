ALTER TABLE "agents"
  ADD COLUMN "summary_enabled"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "summary_prompt"      TEXT,
  ADD COLUMN "summary_min_duration" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "webhook_url"         TEXT,
  ADD COLUMN "webhook_secret"      TEXT,
  ADD COLUMN "webhook_retry_count" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "webhook_retry_delay" INTEGER NOT NULL DEFAULT 60;

CREATE TABLE "call_summaries" (
  "id"                UUID        NOT NULL DEFAULT gen_random_uuid(),
  "call_id"           TEXT        NOT NULL,
  "agent_id"          TEXT        NOT NULL,
  "summary_text"      TEXT        NOT NULL,
  "utterance_count"   INTEGER     NOT NULL,
  "call_duration_sec" INTEGER     NOT NULL,
  "token_count"       INTEGER,
  "webhook_status"    TEXT        NOT NULL DEFAULT 'NONE',
  "webhook_attempts"  INTEGER     NOT NULL DEFAULT 0,
  "webhook_last_error" TEXT,
  "webhook_sent_at"   TIMESTAMPTZ,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "call_summaries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "call_summaries"
  ADD CONSTRAINT "call_summaries_call_id_fkey"   FOREIGN KEY ("call_id")   REFERENCES "calls"("id")  ON DELETE CASCADE,
  ADD CONSTRAINT "call_summaries_agent_id_fkey"  FOREIGN KEY ("agent_id")  REFERENCES "agents"("id");

CREATE UNIQUE INDEX "call_summaries_call_id_key" ON "call_summaries"("call_id");
CREATE INDEX "call_summaries_agent_id_webhook_status_idx" ON "call_summaries"("agent_id", "webhook_status");
