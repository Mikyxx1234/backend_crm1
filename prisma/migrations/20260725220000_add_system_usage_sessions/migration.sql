-- CreateTable
CREATE TABLE "system_usage_sessions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_usage_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_usage_sessions_organizationId_userId_endedAt_idx"
ON "system_usage_sessions"("organizationId", "userId", "endedAt");

-- CreateIndex
CREATE INDEX "system_usage_sessions_organizationId_startedAt_idx"
ON "system_usage_sessions"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "system_usage_sessions_userId_startedAt_idx"
ON "system_usage_sessions"("userId", "startedAt");

-- Partial unique: um usuário só pode ter UMA sessão aberta simultaneamente
-- (várias abas convergem para a mesma sessão via upsert idempotente).
CREATE UNIQUE INDEX "system_usage_sessions_open_per_user_uq"
ON "system_usage_sessions"("userId") WHERE "endedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "system_usage_sessions"
ADD CONSTRAINT "system_usage_sessions_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_usage_sessions"
ADD CONSTRAINT "system_usage_sessions_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
