-- Fixar VÁRIAS mensagens por conversa (estilo WhatsApp, teto de 3 aplicado
-- na rota de pin). Substitui o slot único `conversations.pinnedMessageId`,
-- que fica intocado por compat mas deixa de ser usado pela nova rota.
-- Aditivo e idempotente para permitir rerun em ambientes onde a tabela já
-- foi criada manualmente.

CREATE TABLE IF NOT EXISTS "pinned_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pinned_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pinned_messages_conversationId_messageId_key"
    ON "pinned_messages"("conversationId", "messageId");

CREATE INDEX IF NOT EXISTS "pinned_messages_organizationId_idx"
    ON "pinned_messages"("organizationId");

CREATE INDEX IF NOT EXISTS "pinned_messages_conversationId_createdAt_idx"
    ON "pinned_messages"("conversationId", "createdAt");

CREATE INDEX IF NOT EXISTS "pinned_messages_messageId_idx"
    ON "pinned_messages"("messageId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'pinned_messages_organizationId_fkey'
    ) THEN
        ALTER TABLE "pinned_messages"
            ADD CONSTRAINT "pinned_messages_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'pinned_messages_conversationId_fkey'
    ) THEN
        ALTER TABLE "pinned_messages"
            ADD CONSTRAINT "pinned_messages_conversationId_fkey"
            FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'pinned_messages_messageId_fkey'
    ) THEN
        ALTER TABLE "pinned_messages"
            ADD CONSTRAINT "pinned_messages_messageId_fkey"
            FOREIGN KEY ("messageId") REFERENCES "messages"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Migra a fixada única existente (se houver) para a nova tabela, preservando
-- o prazo. Idempotente via ON CONFLICT no índice único.
INSERT INTO "pinned_messages" ("id", "organizationId", "conversationId", "messageId", "expiresAt", "createdAt")
SELECT
    gen_random_uuid()::text,
    c."organizationId",
    c."id",
    c."pinnedMessageId",
    c."pinnedMessageExpiresAt",
    CURRENT_TIMESTAMP
FROM "conversations" c
WHERE c."pinnedMessageId" IS NOT NULL
ON CONFLICT ("conversationId", "messageId") DO NOTHING;
