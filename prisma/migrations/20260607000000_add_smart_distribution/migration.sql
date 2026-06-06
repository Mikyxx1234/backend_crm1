-- Smart Distribution (Fase 1) — modelo novo de distribuicao via widget
-- `smart_distribution`. Cria as tabelas distribution_responsibles e
-- distribution_logs, aplica RLS no padrao canonico (igual organization_widgets),
-- concede permissoes distribution:* aos presets existentes e roda a rotina de
-- COMPATIBILIDADE: orgs que ja usam DistributionRule ativa recebem o widget
-- ACTIVE e seus DistributionMember viram DistributionResponsible.
--
-- migration-safety: ignore (criacao de tabelas novas + seed/backfill idempotente
-- via IF NOT EXISTS / ON CONFLICT DO NOTHING; NAO altera atribuicao real).

-- ============================================================
-- 1) Tabelas novas
-- ============================================================

CREATE TABLE IF NOT EXISTS "distribution_responsibles" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "participates"    BOOLEAN NOT NULL DEFAULT true,
  "queueLimit"      INTEGER NOT NULL DEFAULT 0,
  "volume"          INTEGER NOT NULL DEFAULT 1,
  "type"            TEXT,
  "paused"          BOOLEAN NOT NULL DEFAULT false,
  "lastExecutionAt" TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "distribution_responsibles_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "distribution_responsibles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "distribution_responsibles_org_user_key"
  ON "distribution_responsibles" ("organizationId", "userId");
CREATE INDEX IF NOT EXISTS "distribution_responsibles_organizationId_idx"
  ON "distribution_responsibles" ("organizationId");

CREATE TABLE IF NOT EXISTS "distribution_logs" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "triggerSource"  TEXT NOT NULL,
  "dealId"         TEXT,
  "contactId"      TEXT,
  "conversationId" TEXT,
  "selectedUserId" TEXT,
  "success"        BOOLEAN NOT NULL,
  "reason"         TEXT NOT NULL,
  "evaluated"      JSONB NOT NULL DEFAULT '[]',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "distribution_logs_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "distribution_logs_org_createdAt_idx"
  ON "distribution_logs" ("organizationId", "createdAt");

-- ============================================================
-- 2) RLS — espelha o padrao canonico (ver organization_widgets /
-- multi_tenancy_rls). Cria as policies tenant_isolation +
-- super_admin_bypass usando os mesmos helpers, mas deixa a RLS
-- DESABILITADA (sem ENABLE/FORCE) — o isolamento ativo hoje e feito
-- na camada de aplicacao (Prisma Extension + getOrgIdOrThrow). Para
-- ligar no futuro: ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY.
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation ON "distribution_responsibles";
DROP POLICY IF EXISTS super_admin_bypass ON "distribution_responsibles";

CREATE POLICY tenant_isolation ON "distribution_responsibles"
USING ("organizationId" = current_organization_id())
WITH CHECK ("organizationId" = current_organization_id());

CREATE POLICY super_admin_bypass ON "distribution_responsibles"
USING (current_is_super_admin())
WITH CHECK (current_is_super_admin());

DROP POLICY IF EXISTS tenant_isolation ON "distribution_logs";
DROP POLICY IF EXISTS super_admin_bypass ON "distribution_logs";

CREATE POLICY tenant_isolation ON "distribution_logs"
USING ("organizationId" = current_organization_id())
WITH CHECK ("organizationId" = current_organization_id());

CREATE POLICY super_admin_bypass ON "distribution_logs"
USING (current_is_super_admin())
WITH CHECK (current_is_super_admin());

-- ============================================================
-- 3) Permissoes distribution:* nos presets existentes
-- ============================================================
-- ADMIN ja tem '*' (coberto por can()). Aqui concedemos aos presets
-- MANAGER (view+manage+execute) e MEMBER (view), apenas anexando as
-- chaves quando ainda nao existem. Idempotente; nao remove nada e nao
-- sobrescreve customizacoes do admin (distribution nunca existiu antes).

UPDATE "roles"
SET "permissions" = "permissions" || ARRAY['distribution:view', 'distribution:manage', 'distribution:execute'],
    "updatedAt" = NOW()
WHERE "systemPreset" = 'MANAGER'
  AND NOT ('distribution:view' = ANY("permissions"));

UPDATE "roles"
SET "permissions" = "permissions" || ARRAY['distribution:view'],
    "updatedAt" = NOW()
WHERE "systemPreset" = 'MEMBER'
  AND NOT ('distribution:view' = ANY("permissions"));

-- ============================================================
-- 4) Compatibilidade — orgs que JA usam distribuicao legada
-- ============================================================
-- Objetivo: nenhuma org perde distribuicao automatica ao migrar para o
-- modelo de widget. Orgs com DistributionRule.isActive=true recebem o
-- widget smart_distribution ACTIVE, e seus DistributionMember viram
-- DistributionResponsible (queueLimit 0 = sem limite; volume 1;
-- lastExecutionAt null; participates true).

-- 4a) Instala/ativa o widget para orgs com regra ativa.
INSERT INTO "organization_widgets"
  ("id", "organizationId", "widgetSlug", "status", "installedById", "config", "installedAt", "createdAt", "updatedAt")
SELECT DISTINCT
  'ow_' || dr."organizationId" || '_smart_distribution',
  dr."organizationId",
  'smart_distribution',
  'ACTIVE',
  NULL,
  NULL::jsonb,
  NOW(),
  NOW(),
  NOW()
FROM "distribution_rules" dr
WHERE dr."isActive" = true
ON CONFLICT ("organizationId", "widgetSlug") DO NOTHING;

-- 4b) Converte membros das regras ativas em responsaveis (dedup por org+user).
INSERT INTO "distribution_responsibles"
  ("id", "organizationId", "userId", "participates", "queueLimit", "volume", "type", "paused", "lastExecutionAt", "createdAt", "updatedAt")
SELECT
  'dr_' || sub."organizationId" || '_' || sub."userId",
  sub."organizationId",
  sub."userId",
  true,
  0,
  1,
  NULL,
  false,
  NULL,
  NOW(),
  NOW()
FROM (
  SELECT DISTINCT dm."organizationId", dm."userId"
  FROM "distribution_members" dm
  JOIN "distribution_rules" dr
    ON dr."id" = dm."ruleId"
   AND dr."isActive" = true
) sub
ON CONFLICT ("organizationId", "userId") DO NOTHING;
