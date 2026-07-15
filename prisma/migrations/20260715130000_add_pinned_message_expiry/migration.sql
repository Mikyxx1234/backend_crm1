-- "Fixar" estilo WhatsApp: prazo de expiração (24h / 7 dias / 30 dias).
-- Aditivo e idempotente.
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "pinnedMessageExpiresAt" TIMESTAMP(3);
