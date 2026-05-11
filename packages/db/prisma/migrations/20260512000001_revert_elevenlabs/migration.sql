-- Revert ElevenLabs integration

-- Drop VoiceProviderBinding table
DROP TABLE IF EXISTS "voice_provider_bindings";

-- Remove ElevenLabs fields from agents
ALTER TABLE "agents" DROP COLUMN IF EXISTS "voice_provider";
ALTER TABLE "agents" DROP COLUMN IF EXISTS "llm_model";
ALTER TABLE "agents" DROP COLUMN IF EXISTS "custom_llm_token";

-- Remove ElevenLabs fields from calls
ALTER TABLE "calls" DROP COLUMN IF EXISTS "llm_model";
ALTER TABLE "calls" DROP COLUMN IF EXISTS "external_conversation_id";
ALTER TABLE "calls" DROP COLUMN IF EXISTS "external_provider_cost";
