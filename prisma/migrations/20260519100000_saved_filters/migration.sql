-- Filtros salvos do Kanban (e potencialmente outras listagens). JSON livre
-- em `filter_config` pra permitir evolução sem migration nova a cada campo.
CREATE TABLE IF NOT EXISTS "saved_filters" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "entityType"     TEXT NOT NULL,            -- ex.: "kanban_deals"
  "name"           TEXT NOT NULL,
  "filterConfig"   JSONB NOT NULL DEFAULT '{}'::jsonb,
  "isDefault"      BOOLEAN NOT NULL DEFAULT FALSE,
  "isShared"       BOOLEAN NOT NULL DEFAULT FALSE,
  "userId"         TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "saved_filters_org_entity_idx"
  ON "saved_filters" ("organizationId", "entityType");

CREATE INDEX IF NOT EXISTS "saved_filters_user_idx"
  ON "saved_filters" ("userId");
