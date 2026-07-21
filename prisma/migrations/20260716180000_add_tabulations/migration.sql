-- Tabulacoes de atendimento (arvore por departamento) + toggle no
-- Department + FK opcional em Conversation.

-- Toggle no departamento (default false = comportamento atual)
ALTER TABLE "departments"
  ADD COLUMN "requireTabulationOnClose" BOOLEAN NOT NULL DEFAULT false;

-- Tabela de tabulacoes (self-ref, escopo org+departamento)
CREATE TABLE "tabulations" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "departmentId"   TEXT NOT NULL,
  "parentId"       TEXT,
  "name"           TEXT NOT NULL,
  "color"          TEXT,
  "position"       INTEGER NOT NULL DEFAULT 0,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tabulations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tabulations_organizationId_idx"
  ON "tabulations"("organizationId");
CREATE INDEX "tabulations_organizationId_departmentId_idx"
  ON "tabulations"("organizationId", "departmentId");
CREATE INDEX "tabulations_organizationId_departmentId_parentId_idx"
  ON "tabulations"("organizationId", "departmentId", "parentId");

ALTER TABLE "tabulations"
  ADD CONSTRAINT "tabulations_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tabulations"
  ADD CONSTRAINT "tabulations_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "departments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tabulations"
  ADD CONSTRAINT "tabulations_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "tabulations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Conversation aponta para a folha escolhida no encerramento (opcional)
ALTER TABLE "conversations"
  ADD COLUMN "tabulationId" TEXT;

CREATE INDEX "conversations_organizationId_tabulationId_idx"
  ON "conversations"("organizationId", "tabulationId");

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_tabulationId_fkey"
  FOREIGN KEY ("tabulationId") REFERENCES "tabulations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
