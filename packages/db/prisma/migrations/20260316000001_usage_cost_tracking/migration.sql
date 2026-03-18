-- Add usage tracking fields to calls table
ALTER TABLE "calls"
  ADD COLUMN IF NOT EXISTS "audio_input_tokens"  INTEGER,
  ADD COLUMN IF NOT EXISTS "audio_output_tokens" INTEGER,
  ADD COLUMN IF NOT EXISTS "text_input_tokens"   INTEGER,
  ADD COLUMN IF NOT EXISTS "text_output_tokens"  INTEGER,
  ADD COLUMN IF NOT EXISTS "telnyx_billed_sec"   INTEGER,
  ADD COLUMN IF NOT EXISTS "deepgram_sec"        INTEGER;

-- Create agent_usage_monthly table
CREATE TABLE IF NOT EXISTS "agent_usage_monthly" (
  "id"                       TEXT NOT NULL,
  "agent_id"                 TEXT NOT NULL,
  "year_month"               TEXT NOT NULL,
  "call_count"               INTEGER NOT NULL DEFAULT 0,
  "total_duration_sec"       INTEGER NOT NULL DEFAULT 0,
  "total_billed_sec"         INTEGER NOT NULL DEFAULT 0,
  "total_audio_input_tokens" INTEGER NOT NULL DEFAULT 0,
  "total_audio_output_tokens" INTEGER NOT NULL DEFAULT 0,
  "total_text_input_tokens"  INTEGER NOT NULL DEFAULT 0,
  "total_text_output_tokens" INTEGER NOT NULL DEFAULT 0,
  "total_summary_tokens"     INTEGER NOT NULL DEFAULT 0,
  "total_deepgram_sec"       INTEGER NOT NULL DEFAULT 0,
  "total_recording_sec"      INTEGER NOT NULL DEFAULT 0,
  "whatsapp_msg_count"       INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "agent_usage_monthly_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_usage_monthly_agent_id_year_month_key" UNIQUE ("agent_id", "year_month"),
  CONSTRAINT "agent_usage_monthly_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
