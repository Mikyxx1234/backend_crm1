-- Groups Kommo (Fase RBAC v2) — cria as 5 tabelas que vivem no schema desde o
-- commit bb82b96 (DEV_BRANCH) mas que nunca tiveram migration gerada. Sem
-- estas tabelas, services/groups.ts e a tela /settings/permissions estouram
-- em qualquer query a prisma.group.* (P2010).
--
-- Idempotente: usa IF NOT EXISTS e DO blocks para podermos rodar com
-- seguranca em DBs que ja foram corrigidos via hotfix manual.

-- =========================================================================
-- 1. Enum PermissionLevel (NONE/SELF/TEAM/ALL)
-- =========================================================================
DO $$ BEGIN
  CREATE TYPE "PermissionLevel" AS ENUM ('NONE', 'SELF', 'TEAM', 'ALL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =========================================================================
-- 2. groups
-- =========================================================================
CREATE TABLE IF NOT EXISTS "groups" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "description"    TEXT,
  "sharedInbox"    BOOLEAN NOT NULL DEFAULT true,
  "mediaAccess"    BOOLEAN NOT NULL DEFAULT true,
  "sidebarRoutes"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "groups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "groups_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "groups_organizationId_name_key"
  ON "groups" ("organizationId", "name");
CREATE INDEX IF NOT EXISTS "groups_organizationId_idx"
  ON "groups" ("organizationId");

-- =========================================================================
-- 3. group_members
-- =========================================================================
CREATE TABLE IF NOT EXISTS "group_members" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "groupId"        TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "group_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "group_members_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "group_members_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "groups"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "group_members_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "group_members_groupId_userId_key"
  ON "group_members" ("groupId", "userId");
CREATE INDEX IF NOT EXISTS "group_members_organizationId_idx"
  ON "group_members" ("organizationId");
CREATE INDEX IF NOT EXISTS "group_members_userId_idx"
  ON "group_members" ("userId");
CREATE INDEX IF NOT EXISTS "group_members_groupId_idx"
  ON "group_members" ("groupId");

-- =========================================================================
-- 4. group_permissions
-- =========================================================================
CREATE TABLE IF NOT EXISTS "group_permissions" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "groupId"        TEXT NOT NULL,
  "resource"       TEXT NOT NULL,
  "action"         TEXT NOT NULL,
  "level"          "PermissionLevel" NOT NULL DEFAULT 'NONE',
  CONSTRAINT "group_permissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "group_permissions_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "groups"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "group_permissions_groupId_resource_action_key"
  ON "group_permissions" ("groupId", "resource", "action");
CREATE INDEX IF NOT EXISTS "group_permissions_organizationId_idx"
  ON "group_permissions" ("organizationId");
CREATE INDEX IF NOT EXISTS "group_permissions_groupId_idx"
  ON "group_permissions" ("groupId");

-- =========================================================================
-- 5. group_stage_grants
-- =========================================================================
CREATE TABLE IF NOT EXISTS "group_stage_grants" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "groupId"        TEXT NOT NULL,
  "stageId"        TEXT NOT NULL,
  "canView"        BOOLEAN NOT NULL DEFAULT true,
  "canEdit"        BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "group_stage_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "group_stage_grants_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "groups"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "group_stage_grants_groupId_stageId_key"
  ON "group_stage_grants" ("groupId", "stageId");
CREATE INDEX IF NOT EXISTS "group_stage_grants_organizationId_idx"
  ON "group_stage_grants" ("organizationId");
CREATE INDEX IF NOT EXISTS "group_stage_grants_groupId_idx"
  ON "group_stage_grants" ("groupId");

-- =========================================================================
-- 6. group_field_grants
-- =========================================================================
CREATE TABLE IF NOT EXISTS "group_field_grants" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "groupId"        TEXT NOT NULL,
  "entity"         TEXT NOT NULL,
  "fieldKey"       TEXT NOT NULL,
  "canView"        BOOLEAN NOT NULL DEFAULT true,
  "canEdit"        BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "group_field_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "group_field_grants_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "groups"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "group_field_grants_groupId_entity_fieldKey_key"
  ON "group_field_grants" ("groupId", "entity", "fieldKey");
CREATE INDEX IF NOT EXISTS "group_field_grants_organizationId_idx"
  ON "group_field_grants" ("organizationId");
CREATE INDEX IF NOT EXISTS "group_field_grants_groupId_idx"
  ON "group_field_grants" ("groupId");
