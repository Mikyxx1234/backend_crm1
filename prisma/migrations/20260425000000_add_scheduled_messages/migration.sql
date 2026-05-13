-- Scheduled Messages
-- Mensagens agendadas para envio futuro em conversas, com cancelamento
-- automático ao detectar interação (cliente ou agente) antes do envio,
-- e fallback para template oficial da Meta em caso de sessão expirada.
--
-- Idempotente: IF NOT EXISTS nos objetos criados para permitir retry
-- de `prisma migrate deploy` se o primeiro run falhar.

-- Enum do status
DO $$ BEGIN
    CREATE TYPE "ScheduledMessageStatus" AS ENUM ('PENDING', 'SENT', 'CANCELLED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Tabela principal
CREATE TABLE IF NOT EXISTS "scheduled_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "mediaName" TEXT,
    "fallbackTemplateName" TEXT,
    "fallbackTemplateParams" JSONB,
    "fallbackTemplateLanguage" TEXT,
    "status" "ScheduledMessageStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "sentMessageId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_messages_pkey" PRIMARY KEY ("id")
);

-- Indexes para queries frequentes:
--  * (conversationId, status) -> listar pendentes de uma conversa + cancelamento em massa
--  * (status, scheduledAt)    -> worker busca "PENDING com scheduledAt <= now()"
--  * (createdById)            -> lista pessoal do usuário
CREATE INDEX IF NOT EXISTS "scheduled_messages_conversationId_status_idx" ON "scheduled_messages"("conversationId", "status");
CREATE INDEX IF NOT EXISTS "scheduled_messages_status_scheduledAt_idx" ON "scheduled_messages"("status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "scheduled_messages_createdById_idx" ON "scheduled_messages"("createdById");

-- FKs
DO $$ BEGIN
    ALTER TABLE "scheduled_messages"
      ADD CONSTRAINT "scheduled_messages_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "scheduled_messages"
      ADD CONSTRAINT "scheduled_messages_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "scheduled_messages"
      ADD CONSTRAINT "scheduled_messages_cancelledById_fkey"
      FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
