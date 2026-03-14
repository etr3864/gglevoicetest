-- Add appointment webhook fields to Agent
ALTER TABLE "agents" ADD COLUMN "appointment_webhook_url" TEXT;
ALTER TABLE "agents" ADD COLUMN "appointment_webhook_secret" TEXT;

-- Add webhook tracking fields to Appointment
ALTER TABLE "appointments" ADD COLUMN "webhook_status" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "appointments" ADD COLUMN "webhook_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "appointments" ADD COLUMN "webhook_last_error" TEXT;
ALTER TABLE "appointments" ADD COLUMN "webhook_sent_at" TIMESTAMP(3);
