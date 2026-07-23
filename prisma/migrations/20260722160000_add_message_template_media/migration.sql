-- Adiciona campos de mídia ao model MessageTemplate (modelos internos do CRM).
-- Idempotente via IF NOT EXISTS — seguro em caso de re-execução.
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "mediaUrl"  TEXT;
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "mediaType" TEXT;
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "mediaName" TEXT;
