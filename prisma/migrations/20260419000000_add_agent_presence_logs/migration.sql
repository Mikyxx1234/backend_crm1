-- Histórico de transições de presença do agente.
-- Cada linha = bloco de tempo em determinado status. endedAt NULL = bloco ativo.
CREATE TABLE IF NOT EXISTS "agent_presence_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AgentOnlineStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_presence_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agent_presence_logs_userId_startedAt_idx"
    ON "agent_presence_logs" ("userId", "startedAt");

CREATE INDEX IF NOT EXISTS "agent_presence_logs_userId_endedAt_idx"
    ON "agent_presence_logs" ("userId", "endedAt");

CREATE INDEX IF NOT EXISTS "agent_presence_logs_userId_status_startedAt_idx"
    ON "agent_presence_logs" ("userId", "status", "startedAt");

ALTER TABLE "agent_presence_logs"
    ADD CONSTRAINT "agent_presence_logs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
