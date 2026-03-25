-- AlterTable: add disposition and callback_time to calls
ALTER TABLE "calls" ADD COLUMN "disposition" TEXT;
ALTER TABLE "calls" ADD COLUMN "callback_time" TIMESTAMP(3);

-- CreateTable: followup_configs
CREATE TABLE "followup_configs" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "general_instruction" TEXT NOT NULL DEFAULT '',
    "active_hours_start" TEXT NOT NULL DEFAULT '09:00',
    "active_hours_end" TEXT NOT NULL DEFAULT '21:00',
    "smart_timing_enabled" BOOLEAN NOT NULL DEFAULT true,
    "smart_timing_min_calls" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "followup_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: followup_steps
CREATE TABLE "followup_steps" (
    "id" TEXT NOT NULL,
    "followup_config_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "delay_minutes" INTEGER NOT NULL,
    "instruction" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "followup_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable: contact_followups
CREATE TABLE "contact_followups" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "current_step_order" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "last_disposition" TEXT,
    "last_call_id" TEXT,
    "summary_for_followup" TEXT,
    "scheduled_for" TIMESTAMP(3),
    "bullmq_job_id" TEXT,
    "step_delay_minutes" INTEGER,
    "step_instruction" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_followups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: followup_configs
CREATE UNIQUE INDEX "followup_configs_agent_id_key" ON "followup_configs"("agent_id");

-- CreateIndex: followup_steps
CREATE UNIQUE INDEX "followup_steps_followup_config_id_order_key" ON "followup_steps"("followup_config_id", "order");

-- CreateIndex: contact_followups
CREATE INDEX "contact_followups_contact_id_agent_id_idx" ON "contact_followups"("contact_id", "agent_id");
CREATE INDEX "contact_followups_status_scheduled_for_idx" ON "contact_followups"("status", "scheduled_for");
CREATE INDEX "contact_followups_agent_id_status_idx" ON "contact_followups"("agent_id", "status");

-- Partial unique index: only one active followup per contact+agent
CREATE UNIQUE INDEX "unique_active_followup"
ON "contact_followups" ("contact_id", "agent_id")
WHERE "status" IN ('PENDING', 'SCHEDULED', 'EXECUTING');

-- AddForeignKey
ALTER TABLE "followup_configs" ADD CONSTRAINT "followup_configs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "followup_steps" ADD CONSTRAINT "followup_steps_followup_config_id_fkey" FOREIGN KEY ("followup_config_id") REFERENCES "followup_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_followups" ADD CONSTRAINT "contact_followups_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_followups" ADD CONSTRAINT "contact_followups_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
