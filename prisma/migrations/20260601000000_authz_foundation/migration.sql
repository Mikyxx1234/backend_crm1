-- Authz Foundation (Fase 1) — RBAC com permissions atomicas e custom roles.
-- migration-safety: ignore (criacao de tabelas novas + seed idempotente).
--
-- Cria os 3 modelos novos (roles, user_role_assignments, organization_settings),
-- seedea os presets ADMIN/MANAGER/MEMBER pra TODA org existente, atribui o
-- preset apropriado a cada User com base no User.role atual, e migra os
-- valores de SystemSetting (visibility.*, selfAssign.*) pra cada org
-- (eliminando o bug de multi-tenancy onde essas chaves eram globais).
--
-- Idempotencia: tudo usa IF NOT EXISTS / ON CONFLICT DO NOTHING — re-rodar
-- a migration nao duplica registros nem sobrescreve permissions editadas.

-- ──────────────────────────────────────────────
-- 1) Schema das tabelas novas
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "roles" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "description"    TEXT,
  "systemPreset"   TEXT,
  "isSystem"       BOOLEAN NOT NULL DEFAULT false,
  "permissions"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "roles_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "roles_organizationId_name_key"
  ON "roles" ("organizationId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "roles_organizationId_systemPreset_key"
  ON "roles" ("organizationId", "systemPreset");
CREATE INDEX IF NOT EXISTS "roles_organizationId_idx"
  ON "roles" ("organizationId");

CREATE TABLE IF NOT EXISTS "user_role_assignments" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "roleId"         TEXT NOT NULL,
  "assignedById"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_role_assignments_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_role_assignments_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_role_assignments_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "roles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_role_assignments_userId_roleId_key"
  ON "user_role_assignments" ("userId", "roleId");
CREATE INDEX IF NOT EXISTS "user_role_assignments_organizationId_idx"
  ON "user_role_assignments" ("organizationId");
CREATE INDEX IF NOT EXISTS "user_role_assignments_userId_idx"
  ON "user_role_assignments" ("userId");
CREATE INDEX IF NOT EXISTS "user_role_assignments_roleId_idx"
  ON "user_role_assignments" ("roleId");

CREATE TABLE IF NOT EXISTS "organization_settings" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "value"          TEXT NOT NULL,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organization_settings_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "organization_settings_organizationId_key_key"
  ON "organization_settings" ("organizationId", "key");
CREATE INDEX IF NOT EXISTS "organization_settings_organizationId_idx"
  ON "organization_settings" ("organizationId");

-- ──────────────────────────────────────────────
-- 2) RLS — isolamento por tenant
-- ──────────────────────────────────────────────
-- Mesmo padrao das outras tabelas tenant-scoped (multi_tenancy_rls).
-- Super-admins tem bypass via role com BYPASSRLS, configurado no init.

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "roles_tenant_isolation" ON "roles";
CREATE POLICY "roles_tenant_isolation"
  ON "roles"
  USING ("organizationId" = current_setting('app.organization_id', true)::text);
DROP POLICY IF EXISTS "roles_tenant_isolation_insert" ON "roles";
CREATE POLICY "roles_tenant_isolation_insert"
  ON "roles"
  FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true)::text);

ALTER TABLE "user_role_assignments" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_role_assignments_tenant_isolation" ON "user_role_assignments";
CREATE POLICY "user_role_assignments_tenant_isolation"
  ON "user_role_assignments"
  USING ("organizationId" = current_setting('app.organization_id', true)::text);
DROP POLICY IF EXISTS "user_role_assignments_tenant_isolation_insert" ON "user_role_assignments";
CREATE POLICY "user_role_assignments_tenant_isolation_insert"
  ON "user_role_assignments"
  FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true)::text);

ALTER TABLE "organization_settings" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "organization_settings_tenant_isolation" ON "organization_settings";
CREATE POLICY "organization_settings_tenant_isolation"
  ON "organization_settings"
  USING ("organizationId" = current_setting('app.organization_id', true)::text);
DROP POLICY IF EXISTS "organization_settings_tenant_isolation_insert" ON "organization_settings";
CREATE POLICY "organization_settings_tenant_isolation_insert"
  ON "organization_settings"
  FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true)::text);

-- ──────────────────────────────────────────────
-- 3) Seed dos presets ADMIN/MANAGER/MEMBER pra cada org
-- ──────────────────────────────────────────────
-- IMPORTANTE: as permissions abaixo refletem o COMPORTAMENTO ATUAL
-- (zero quebra em produção). A fonte da verdade canonica vive em
-- src/lib/authz/permissions.ts; o seed aqui replica o default de la.
-- Quando o admin editar via UI, esses valores sao sobrescritos no banco.
--
-- Convencao: "<resource>:<action>". Wildcards permitidos:
--   "*"               = todas as permissions
--   "<resource>:*"    = todas as actions do resource
-- Resolucao de wildcard fica no helper `can()` em src/lib/authz.

INSERT INTO "roles" ("id", "organizationId", "name", "description", "systemPreset", "isSystem", "permissions", "createdAt", "updatedAt")
SELECT
  'role_' || o."id" || '_admin',
  o."id",
  'Administrador',
  'Acesso total a organização. Não removível.',
  'ADMIN',
  true,
  ARRAY['*'],
  NOW(),
  NOW()
FROM "organizations" o
ON CONFLICT ("organizationId", "systemPreset") DO NOTHING;

INSERT INTO "roles" ("id", "organizationId", "name", "description", "systemPreset", "isSystem", "permissions", "createdAt", "updatedAt")
SELECT
  'role_' || o."id" || '_manager',
  o."id",
  'Gestor',
  'Pode gerenciar equipe, funis, automações e relatórios.',
  'MANAGER',
  true,
  ARRAY[
    -- Gestao
    'pipeline:view', 'pipeline:create', 'pipeline:edit', 'pipeline:delete', 'pipeline:manage_stages',
    'contact:view', 'contact:create', 'contact:edit', 'contact:delete', 'contact:export', 'contact:import',
    'company:view', 'company:create', 'company:edit', 'company:delete',
    'deal:view', 'deal:create', 'deal:edit', 'deal:delete', 'deal:transfer_owner',
    'conversation:view', 'conversation:claim', 'conversation:reassign_others', 'conversation:resolve',
    'automation:view', 'automation:create', 'automation:edit', 'automation:publish', 'automation:delete',
    'ai_agent:view', 'ai_agent:create', 'ai_agent:edit', 'ai_agent:delete',
    'campaign:view', 'campaign:create', 'campaign:edit', 'campaign:send',
    'report:view', 'report:export',
    'settings:team', 'settings:branding', 'settings:channels',
    'tag:view', 'tag:create', 'tag:edit', 'tag:delete',
    'task:view', 'task:create', 'task:edit', 'task:delete'
  ],
  NOW(),
  NOW()
FROM "organizations" o
ON CONFLICT ("organizationId", "systemPreset") DO NOTHING;

INSERT INTO "roles" ("id", "organizationId", "name", "description", "systemPreset", "isSystem", "permissions", "createdAt", "updatedAt")
SELECT
  'role_' || o."id" || '_member',
  o."id",
  'Operador',
  'Atende leads, gerencia próprios negócios e tarefas.',
  'MEMBER',
  true,
  ARRAY[
    'pipeline:view',
    'contact:view', 'contact:create', 'contact:edit',
    'company:view',
    'deal:view', 'deal:create', 'deal:edit',
    'conversation:view', 'conversation:claim', 'conversation:resolve',
    'tag:view',
    'task:view', 'task:create', 'task:edit'
  ],
  NOW(),
  NOW()
FROM "organizations" o
ON CONFLICT ("organizationId", "systemPreset") DO NOTHING;

-- ──────────────────────────────────────────────
-- 4) Backfill: atribui o preset apropriado a cada User existente
-- ──────────────────────────────────────────────
-- Cada user recebe a Role do preset que casa com seu User.role atual.
-- Super-admin EduIT (organizationId=null) NAO recebe assignment — ele
-- bypassa authz inteiro via flag isSuperAdmin (mesma logica de RLS).

INSERT INTO "user_role_assignments" ("id", "organizationId", "userId", "roleId", "createdAt")
SELECT
  'ura_' || u."id" || '_' || r."id",
  u."organizationId",
  u."id",
  r."id",
  NOW()
FROM "users" u
JOIN "roles" r
  ON r."organizationId" = u."organizationId"
  AND r."systemPreset" = u."role"::text
WHERE u."organizationId" IS NOT NULL
  AND u."isErased" = false
ON CONFLICT ("userId", "roleId") DO NOTHING;

-- ──────────────────────────────────────────────
-- 5) Backfill: migra SystemSetting (global) -> OrganizationSetting (por org)
-- ──────────────────────────────────────────────
-- Bug fix: visibility.* e selfAssign.* eram globais em SystemSetting,
-- vazando config entre tenants. Aqui replicamos o valor global atual
-- pra cada org como ponto de partida; orgs que querem comportamento
-- diferente editam via UI dedicada.
--
-- Nao apagamos SystemSetting na mesma migration — outros lugares ainda
-- leem dela ate o cutover do `lib/visibility.ts` e `lib/self-assign.ts`
-- (Fase 3). Apos o cutover, uma migration futura limpa as chaves
-- migradas de SystemSetting.

INSERT INTO "organization_settings" ("id", "organizationId", "key", "value", "updatedAt")
SELECT
  'os_' || o."id" || '_' || REPLACE(s."key", '.', '_'),
  o."id",
  s."key",
  s."value",
  NOW()
FROM "organizations" o
CROSS JOIN "system_settings" s
WHERE s."key" LIKE 'visibility.%' OR s."key" LIKE 'selfAssign.%'
ON CONFLICT ("organizationId", "key") DO NOTHING;
