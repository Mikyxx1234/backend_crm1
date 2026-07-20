-- Papeis absorvem Grupos (RBAC v3). Os extras (sharedInbox/mediaAccess) e os
-- grants de etapa/campo passam a viver no modelo Role; o modelo Group inteiro
-- e removido (dados descartados, conforme decisao de produto). Enforcement
-- aplicado atras da flag `rbac_granular_scope_v1`.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS /
-- DROP TABLE IF EXISTS para rodar com seguranca em qualquer estado.

-- =========================================================================
-- 1. Extras de acesso no papel
-- =========================================================================
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "sharedInbox" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "mediaAccess" BOOLEAN NOT NULL DEFAULT true;

-- =========================================================================
-- 2. role_stage_grants (visibilidade por etapa do funil, por papel)
-- =========================================================================
CREATE TABLE IF NOT EXISTS "role_stage_grants" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "roleId"         TEXT NOT NULL,
  "stageId"        TEXT NOT NULL,
  "canView"        BOOLEAN NOT NULL DEFAULT true,
  "canEdit"        BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "role_stage_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "role_stage_grants_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "roles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "role_stage_grants_roleId_stageId_key"
  ON "role_stage_grants" ("roleId", "stageId");
CREATE INDEX IF NOT EXISTS "role_stage_grants_organizationId_idx"
  ON "role_stage_grants" ("organizationId");
CREATE INDEX IF NOT EXISTS "role_stage_grants_roleId_idx"
  ON "role_stage_grants" ("roleId");

-- =========================================================================
-- 3. role_field_grants (permissoes por campo, por papel)
-- =========================================================================
CREATE TABLE IF NOT EXISTS "role_field_grants" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "roleId"         TEXT NOT NULL,
  "entity"         TEXT NOT NULL,
  "fieldKey"       TEXT NOT NULL,
  "canView"        BOOLEAN NOT NULL DEFAULT true,
  "canEdit"        BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "role_field_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "role_field_grants_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "roles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "role_field_grants_roleId_entity_fieldKey_key"
  ON "role_field_grants" ("roleId", "entity", "fieldKey");
CREATE INDEX IF NOT EXISTS "role_field_grants_organizationId_idx"
  ON "role_field_grants" ("organizationId");
CREATE INDEX IF NOT EXISTS "role_field_grants_roleId_idx"
  ON "role_field_grants" ("roleId");

-- =========================================================================
-- 4. Remove o modelo Group (5 tabelas). CASCADE derruba FKs dependentes.
--    O tipo enum "PermissionLevel" e mantido (ainda declarado no schema).
-- =========================================================================
DROP TABLE IF EXISTS "group_field_grants" CASCADE;
DROP TABLE IF EXISTS "group_stage_grants" CASCADE;
DROP TABLE IF EXISTS "group_permissions" CASCADE;
DROP TABLE IF EXISTS "group_members" CASCADE;
DROP TABLE IF EXISTS "groups" CASCADE;
