-- AI Agents (operadores virtuais)
-- Cria extensão pgvector, novos enums, tabelas de configuração,
-- conhecimento (com coluna vector(1536)), runs e trace de mensagens.
-- Também adiciona o campo type no User e a FK aiAgentUserId em messages.

-- Habilita pgvector (requer superuser ou extensão pré-aprovada no host).
-- Em Supabase e na maioria dos Postgres gerenciados já está disponível.
CREATE EXTENSION IF NOT EXISTS vector;

-- ── User: torna hashedPassword opcional + adiciona type ──────────────
ALTER TABLE "users"
  ALTER COLUMN "hashedPassword" DROP NOT NULL;

CREATE TYPE "UserType" AS ENUM ('HUMAN', 'AI');

ALTER TABLE "users"
  ADD COLUMN "type" "UserType" NOT NULL DEFAULT 'HUMAN';

CREATE INDEX "users_type_idx" ON "users"("type");

-- ── Message: FK para o User virtual do agente IA ─────────────────────
ALTER TABLE "messages"
  ADD COLUMN "aiAgentUserId" TEXT;

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_aiAgentUserId_fkey"
  FOREIGN KEY ("aiAgentUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "messages_aiAgentUserId_createdAt_idx"
  ON "messages"("aiAgentUserId", "createdAt");

-- ── Enums AI Agents ──────────────────────────────────────────────────
CREATE TYPE "AIAgentArchetype" AS ENUM ('SDR', 'ATENDIMENTO', 'VENDEDOR', 'SUPORTE');
CREATE TYPE "AIAgentAutonomy"  AS ENUM ('AUTONOMOUS', 'DRAFT');
CREATE TYPE "AIAgentKnowledgeStatus" AS ENUM ('PENDING', 'INDEXING', 'READY', 'FAILED');
CREATE TYPE "AIAgentRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'HANDOFF');

-- ── AIAgentConfig ────────────────────────────────────────────────────
CREATE TABLE "ai_agent_configs" (
  "id"                   TEXT NOT NULL,
  "userId"               TEXT NOT NULL,
  "archetype"            "AIAgentArchetype" NOT NULL DEFAULT 'SDR',
  "model"                TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  "temperature"          DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  "maxTokens"            INTEGER NOT NULL DEFAULT 1024,
  "systemPromptTemplate" TEXT NOT NULL,
  "systemPromptOverride" TEXT,
  "tone"                 TEXT NOT NULL DEFAULT 'profissional e cordial',
  "language"             TEXT NOT NULL DEFAULT 'pt-BR',
  "autonomyMode"         "AIAgentAutonomy" NOT NULL DEFAULT 'DRAFT',
  "enabledTools"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "dailyTokenCap"        INTEGER NOT NULL DEFAULT 0,
  "pipelineId"           TEXT,
  "channelId"            TEXT,
  "active"               BOOLEAN NOT NULL DEFAULT true,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ai_agent_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_agent_configs_userId_key" ON "ai_agent_configs"("userId");
CREATE INDEX "ai_agent_configs_archetype_idx" ON "ai_agent_configs"("archetype");
CREATE INDEX "ai_agent_configs_active_idx" ON "ai_agent_configs"("active");

ALTER TABLE "ai_agent_configs"
  ADD CONSTRAINT "ai_agent_configs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── AIAgentKnowledgeDoc ──────────────────────────────────────────────
CREATE TABLE "ai_agent_knowledge_docs" (
  "id"           TEXT NOT NULL,
  "agentId"      TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "source"       TEXT NOT NULL DEFAULT 'upload',
  "mimeType"     TEXT,
  "sizeBytes"    INTEGER NOT NULL DEFAULT 0,
  "storageUrl"   TEXT,
  "status"       "AIAgentKnowledgeStatus" NOT NULL DEFAULT 'PENDING',
  "errorMessage" TEXT,
  "chunkCount"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ai_agent_knowledge_docs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_agent_knowledge_docs_agentId_status_idx"
  ON "ai_agent_knowledge_docs"("agentId", "status");

ALTER TABLE "ai_agent_knowledge_docs"
  ADD CONSTRAINT "ai_agent_knowledge_docs_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "ai_agent_configs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── AIAgentKnowledgeChunk (com coluna vector do pgvector) ────────────
-- Prisma não suporta `vector` nativamente; a coluna é gerenciada via
-- SQL cru e acessada via `$queryRaw`. Os outros campos são espelhados
-- no model Prisma `AIAgentKnowledgeChunk`.
CREATE TABLE "ai_agent_knowledge_chunks" (
  "id"         TEXT NOT NULL,
  "docId"      TEXT NOT NULL,
  "content"    TEXT NOT NULL,
  "position"   INTEGER NOT NULL DEFAULT 0,
  "tokenCount" INTEGER NOT NULL DEFAULT 0,
  "embedding"  vector(1536),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_agent_knowledge_chunks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_agent_knowledge_chunks_docId_idx"
  ON "ai_agent_knowledge_chunks"("docId");

-- Índice ivfflat para cosine distance (operador <=>). Lists=100 é
-- adequado pra até ~100k chunks; aumentar conforme cresce o volume.
CREATE INDEX "ai_agent_knowledge_chunks_embedding_idx"
  ON "ai_agent_knowledge_chunks"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE "ai_agent_knowledge_chunks"
  ADD CONSTRAINT "ai_agent_knowledge_chunks_docId_fkey"
  FOREIGN KEY ("docId") REFERENCES "ai_agent_knowledge_docs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── AIAgentRun ───────────────────────────────────────────────────────
CREATE TABLE "ai_agent_runs" (
  "id"              TEXT NOT NULL,
  "agentId"         TEXT NOT NULL,
  "source"          TEXT NOT NULL DEFAULT 'inbox',
  "conversationId"  TEXT,
  "contactId"       TEXT,
  "responsePreview" TEXT,
  "inputTokens"     INTEGER NOT NULL DEFAULT 0,
  "outputTokens"    INTEGER NOT NULL DEFAULT 0,
  "costUsd"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status"          "AIAgentRunStatus" NOT NULL DEFAULT 'RUNNING',
  "errorMessage"    TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"      TIMESTAMP(3),

  CONSTRAINT "ai_agent_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_agent_runs_agentId_createdAt_idx"
  ON "ai_agent_runs"("agentId", "createdAt");
CREATE INDEX "ai_agent_runs_conversationId_idx"
  ON "ai_agent_runs"("conversationId");
CREATE INDEX "ai_agent_runs_status_idx"
  ON "ai_agent_runs"("status");

ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "ai_agent_configs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── AIAgentMessage (trace) ───────────────────────────────────────────
CREATE TABLE "ai_agent_messages" (
  "id"        TEXT NOT NULL,
  "runId"     TEXT NOT NULL,
  "role"      TEXT NOT NULL,
  "content"   TEXT NOT NULL,
  "toolName"  TEXT,
  "toolData"  JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_agent_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_agent_messages_runId_createdAt_idx"
  ON "ai_agent_messages"("runId", "createdAt");

ALTER TABLE "ai_agent_messages"
  ADD CONSTRAINT "ai_agent_messages_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ai_agent_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
