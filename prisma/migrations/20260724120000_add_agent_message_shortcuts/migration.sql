-- Preferências pessoais do agente sobre os atalhos "/" (Mensagens prontas):
-- favorito + contador de uso por item, isolado por (organizationId, userId).
-- Aditivo e idempotente para permitir rerun em ambientes onde a tabela já
-- foi criada manualmente.

CREATE TABLE IF NOT EXISTS "agent_message_shortcuts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemKind" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_message_shortcuts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_message_shortcuts_userId_itemKind_itemId_key"
    ON "agent_message_shortcuts"("userId", "itemKind", "itemId");

CREATE INDEX IF NOT EXISTS "agent_message_shortcuts_organizationId_idx"
    ON "agent_message_shortcuts"("organizationId");

CREATE INDEX IF NOT EXISTS "agent_message_shortcuts_userId_idx"
    ON "agent_message_shortcuts"("userId");

-- FKs em cascade para Organization/User — remover a org ou o usuário limpa
-- as preferências órfãs automaticamente. Criadas via DO-block idempotente.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'agent_message_shortcuts_organizationId_fkey'
    ) THEN
        ALTER TABLE "agent_message_shortcuts"
            ADD CONSTRAINT "agent_message_shortcuts_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'agent_message_shortcuts_userId_fkey'
    ) THEN
        ALTER TABLE "agent_message_shortcuts"
            ADD CONSTRAINT "agent_message_shortcuts_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
