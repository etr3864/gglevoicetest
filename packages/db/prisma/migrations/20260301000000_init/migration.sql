-- Initial schema baseline (safe to run on existing DB — uses IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "agents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "api_key" TEXT,
    "phone_number" TEXT,
    "telnyx_phone_id" TEXT,
    "telnyx_app_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "voice" TEXT NOT NULL DEFAULT 'Aoede',
    "base_prompt" TEXT,
    "opening_message" TEXT,
    "model_config" JSONB,
    "active_hours" JSONB,
    "calendar_config" JSONB,
    "calendar_instructions" TEXT,
    "business_hours" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "contacts" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "gender" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "total_calls" INTEGER NOT NULL DEFAULT 0,
    "total_duration_sec" INTEGER NOT NULL DEFAULT 0,
    "last_call_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "calls" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "context" JSONB,
    "recording_url" TEXT,
    "duration_sec" INTEGER,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "utterances" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "speaker" TEXT NOT NULL,
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    CONSTRAINT "utterances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "appointments" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "call_id" TEXT,
    "google_event_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "phone" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "agents_api_key_key" ON "agents"("api_key");
CREATE UNIQUE INDEX IF NOT EXISTS "agents_phone_number_key" ON "agents"("phone_number");
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_phone_key" ON "contacts"("phone");
CREATE INDEX IF NOT EXISTS "calls_agent_id_created_at_idx" ON "calls"("agent_id", "created_at");
CREATE INDEX IF NOT EXISTS "utterances_call_id_start_ms_idx" ON "utterances"("call_id", "start_ms");
CREATE INDEX IF NOT EXISTS "appointments_agent_id_start_time_idx" ON "appointments"("agent_id", "start_time");
CREATE INDEX IF NOT EXISTS "appointments_contact_id_idx" ON "appointments"("contact_id");

DO $$ BEGIN
  ALTER TABLE "calls" ADD CONSTRAINT "calls_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "calls" ADD CONSTRAINT "calls_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "utterances" ADD CONSTRAINT "utterances_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "appointments" ADD CONSTRAINT "appointments_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "appointments" ADD CONSTRAINT "appointments_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
