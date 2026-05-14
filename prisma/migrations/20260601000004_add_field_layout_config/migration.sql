-- FieldLayoutConfig
-- Layout de seções/campos por contexto para DealWorkspace e Inbox CRM.
-- Suporta padrão da organização (userId NULL) e override pessoal (userId preenchido).
-- Idempotente para retry seguro no deploy.

CREATE TABLE IF NOT EXISTS "field_layout_configs" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId"         TEXT,
    "context"        TEXT NOT NULL,
    "sections"       JSONB NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_layout_configs_pkey" PRIMARY KEY ("id")
);

-- Índices
CREATE UNIQUE INDEX IF NOT EXISTS "field_layout_configs_organizationId_userId_context_key"
    ON "field_layout_configs"("organizationId", "userId", "context");

CREATE INDEX IF NOT EXISTS "field_layout_configs_organizationId_context_idx"
    ON "field_layout_configs"("organizationId", "context");

-- FKs
DO $$ BEGIN
    ALTER TABLE "field_layout_configs"
      ADD CONSTRAINT "field_layout_configs_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "field_layout_configs"
      ADD CONSTRAINT "field_layout_configs_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
