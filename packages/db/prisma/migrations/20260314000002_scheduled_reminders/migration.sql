-- Add callType to calls table
ALTER TABLE "calls" ADD COLUMN "call_type" TEXT NOT NULL DEFAULT 'regular';

-- Create scheduled_reminders table
CREATE TABLE "scheduled_reminders" (
    "id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "call_id" TEXT,
    "rule_index" INTEGER NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "content_type" TEXT NOT NULL,
    "resolved_content" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "last_error" TEXT,
    "bullmq_job_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_reminders_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one reminder per rule per appointment
ALTER TABLE "scheduled_reminders" ADD CONSTRAINT "scheduled_reminders_appointment_id_rule_index_key" UNIQUE ("appointment_id", "rule_index");

-- Indexes
CREATE INDEX "scheduled_reminders_agent_id_status_idx" ON "scheduled_reminders"("agent_id", "status");
CREATE INDEX "scheduled_reminders_scheduled_for_status_idx" ON "scheduled_reminders"("scheduled_for", "status");

-- Foreign keys
ALTER TABLE "scheduled_reminders" ADD CONSTRAINT "scheduled_reminders_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduled_reminders" ADD CONSTRAINT "scheduled_reminders_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_reminders" ADD CONSTRAINT "scheduled_reminders_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scheduled_reminders" ADD CONSTRAINT "scheduled_reminders_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
