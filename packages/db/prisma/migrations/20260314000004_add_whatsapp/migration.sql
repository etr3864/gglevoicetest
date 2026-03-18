ALTER TABLE "agents"
  ADD COLUMN "whatsapp_provider" TEXT,
  ADD COLUMN "whatsapp_config" TEXT,
  ADD COLUMN "whatsapp_instructions" TEXT,
  ADD COLUMN "whatsapp_context_messages" INTEGER NOT NULL DEFAULT 20;

CREATE TABLE "whatsapp_messages" (
  "id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "contact_phone" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "content" TEXT NOT NULL,
  "provider_message_id" TEXT,
  "call_id" TEXT,
  "error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "whatsapp_messages_agent_id_contact_phone_created_at_idx"
  ON "whatsapp_messages"("agent_id", "contact_phone", "created_at");

CREATE INDEX "whatsapp_messages_call_id_idx"
  ON "whatsapp_messages"("call_id");

CREATE INDEX "whatsapp_messages_provider_message_id_idx"
  ON "whatsapp_messages"("provider_message_id");

ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
