ALTER TABLE "appointments"
  ADD COLUMN "pending_webhook_event"   TEXT,
  ADD COLUMN "pending_webhook_call_id" TEXT;

CREATE INDEX "appointments_pending_webhook_call_id_idx"
  ON "appointments"("pending_webhook_call_id");
