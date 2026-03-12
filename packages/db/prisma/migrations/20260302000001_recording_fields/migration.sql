-- Add userId to agents for tenant isolation
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "user_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add call_control_id to calls for recording webhook lookup
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "call_control_id" TEXT;
CREATE INDEX IF NOT EXISTS "calls_call_control_id_idx" ON "calls"("call_control_id");

-- Add recording fields to calls
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "telnyx_recording_id" TEXT;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "recording_status" TEXT;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "recording_duration" INTEGER;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "recording_size_bytes" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "calls_telnyx_recording_id_key" ON "calls"("telnyx_recording_id");
