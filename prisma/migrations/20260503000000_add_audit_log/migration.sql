-- PR 4.2: AuditLog central
--
-- Tabela append-only de eventos sensiveis pra investigacao,
-- compliance e painel /admin/audit. Indices cobrem os 4 acessos
-- principais:
--   1) org filtra → "tudo que aconteceu na minha conta" (org admin)
--   2) (entity, entityId) → "historico desse user/canal/token"
--   3) (actorId, createdAt) → "tudo que esse usuario fez"
--   4) (action, createdAt) → "monitorar nova ocorrencia de X"

CREATE TABLE "audit_logs" (
    "id"                 TEXT         NOT NULL,
    "organizationId"     TEXT,
    "actorId"            TEXT,
    "actorEmail"         TEXT,
    "actorIsSuperAdmin"  BOOLEAN      NOT NULL DEFAULT false,
    "entity"             TEXT         NOT NULL,
    "entityId"           TEXT,
    "action"             TEXT         NOT NULL,
    "before"             JSONB,
    "after"              JSONB,
    "metadata"           JSONB,
    "ip"                 TEXT,
    "userAgent"          TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_organizationId_createdAt_idx"
    ON "audit_logs"("organizationId", "createdAt");
CREATE INDEX "audit_logs_entity_entityId_idx"
    ON "audit_logs"("entity", "entityId");
CREATE INDEX "audit_logs_actorId_createdAt_idx"
    ON "audit_logs"("actorId", "createdAt");
CREATE INDEX "audit_logs_action_createdAt_idx"
    ON "audit_logs"("action", "createdAt");
CREATE INDEX "audit_logs_createdAt_idx"
    ON "audit_logs"("createdAt");

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
