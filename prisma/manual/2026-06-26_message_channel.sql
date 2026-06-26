-- Feature: canal/conexão por mensagem (distinguir contas WhatsApp na mesma conversa).
-- Aditivo e idempotente — aplicar manualmente via `prisma db execute` (o projeto
-- não usa migrations versionadas; o schema é sincronizado via db push, mas há
-- drift no DB de dev que impede um db push completo seguro).
--
-- Aplicar:
--   npx prisma db execute --schema=prisma/schema.prisma --file prisma/manual/2026-06-26_message_channel.sql

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "channelId" TEXT;

CREATE INDEX IF NOT EXISTS "messages_channelId_idx" ON "messages" ("channelId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_channelId_fkey'
  ) THEN
    ALTER TABLE "messages"
      ADD CONSTRAINT "messages_channelId_fkey"
      FOREIGN KEY ("channelId") REFERENCES "channels" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
