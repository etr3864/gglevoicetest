CREATE TABLE "whatsapp_templates" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "meta_id" TEXT,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "components" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_templates_agent_id_name_language_key" ON "whatsapp_templates"("agent_id", "name", "language");
CREATE INDEX "whatsapp_templates_agent_id_status_idx" ON "whatsapp_templates"("agent_id", "status");

ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
