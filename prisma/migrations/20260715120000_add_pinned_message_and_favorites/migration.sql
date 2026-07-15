-- Fixar mensagem (banner estilo WhatsApp) + Favoritar mensagem (marcador
-- pessoal por agente). Aditivo e idempotente para permitir rerun em
-- ambientes onde a coluna/tabela já foi criada manualmente.

-- "Fixar": um único slot por conversa, aceita qualquer mensagem (não só
-- notas — isso já existe via "pinnedNoteId", que fica intocado).
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "pinnedMessageId" TEXT;

-- "Favoritar": lista pessoal por agente. FK em cascade para Message/User/
-- Organization — remover a mensagem, o usuário ou a org limpa os favoritos
-- órfãos automaticamente.
CREATE TABLE IF NOT EXISTS "favorite_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "favorite_messages_userId_messageId_key"
    ON "favorite_messages"("userId", "messageId");

CREATE INDEX IF NOT EXISTS "favorite_messages_organizationId_idx"
    ON "favorite_messages"("organizationId");

CREATE INDEX IF NOT EXISTS "favorite_messages_messageId_idx"
    ON "favorite_messages"("messageId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'favorite_messages_organizationId_fkey'
    ) THEN
        ALTER TABLE "favorite_messages"
            ADD CONSTRAINT "favorite_messages_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'favorite_messages_userId_fkey'
    ) THEN
        ALTER TABLE "favorite_messages"
            ADD CONSTRAINT "favorite_messages_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'favorite_messages_messageId_fkey'
    ) THEN
        ALTER TABLE "favorite_messages"
            ADD CONSTRAINT "favorite_messages_messageId_fkey"
            FOREIGN KEY ("messageId") REFERENCES "messages"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
