-- Uso REAL do sistema — sessões de atividade humana visível.
-- Idempotente: usa IF NOT EXISTS onde suportado.

-- CreateTable
CREATE TABLE IF NOT EXISTS "system_activity_sessions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "interactionCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_activity_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "system_activity_sessions_organizationId_userId_endedAt_idx"
ON "system_activity_sessions"("organizationId", "userId", "endedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "system_activity_sessions_organizationId_startedAt_idx"
ON "system_activity_sessions"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "system_activity_sessions_organizationId_lastActivityAt_idx"
ON "system_activity_sessions"("organizationId", "lastActivityAt");

-- Partial unique: no máximo UMA sessão aberta por (org, usuário).
-- Múltiplas abas convergem para a mesma sessão via upsert idempotente.
CREATE UNIQUE INDEX IF NOT EXISTS "system_activity_sessions_open_per_user_org_uq"
ON "system_activity_sessions"("organizationId", "userId")
WHERE "endedAt" IS NULL;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "system_activity_sessions"
  ADD CONSTRAINT "system_activity_sessions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "system_activity_sessions"
  ADD CONSTRAINT "system_activity_sessions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
