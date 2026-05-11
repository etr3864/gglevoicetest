-- Agent: voice provider fields
ALTER TABLE "agents" ADD COLUMN "voice_provider" TEXT NOT NULL DEFAULT 'gemini_live';
ALTER TABLE "agents" ADD COLUMN "llm_model" TEXT;
ALTER TABLE "agents" ADD COLUMN "custom_llm_token" TEXT;
CREATE UNIQUE INDEX "agents_custom_llm_token_key" ON "agents"("custom_llm_token");

-- Call: ElevenLabs tracking fields
ALTER TABLE "calls" ADD COLUMN "llm_model" TEXT;
ALTER TABLE "calls" ADD COLUMN "external_conversation_id" TEXT;
ALTER TABLE "calls" ADD COLUMN "external_provider_cost" DOUBLE PRECISION;
CREATE UNIQUE INDEX "calls_external_conversation_id_key" ON "calls"("external_conversation_id");

-- VoiceProviderBinding table
CREATE TABLE "voice_provider_bindings" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "sync_status" TEXT NOT NULL DEFAULT 'synced',
    "sync_error" TEXT,
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_provider_bindings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "voice_provider_bindings_provider_external_id_idx" ON "voice_provider_bindings"("provider", "external_id");
CREATE UNIQUE INDEX "voice_provider_bindings_agent_id_provider_key" ON "voice_provider_bindings"("agent_id", "provider");

ALTER TABLE "voice_provider_bindings" ADD CONSTRAINT "voice_provider_bindings_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
