ALTER TABLE "whatsapp_templates" ADD COLUMN "description" TEXT;
ALTER TABLE "whatsapp_messages" ADD COLUMN "template_name" TEXT;
ALTER TABLE "whatsapp_messages" ADD COLUMN "template_vars" JSONB;
