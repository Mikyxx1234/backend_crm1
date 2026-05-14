-- Org-settings cutover (Multi-tenancy v0 — finalizacao).
-- migration-safety: ignore (apenas backfill idempotente em organization_settings).
--
-- A chave `loss_reason_required` continuava em system_settings (global,
-- vazava entre tenants). Esta migration:
--
--   1. Replica o valor global atual para CADA org como
--      `deals.loss_reason_required` em organization_settings.
--   2. Apaga `loss_reason_required` da tabela global system_settings.
--   3. Apaga as chaves `visibility.*` e `selfAssign.*` que ja foram
--      migradas em 20260601000000_authz_foundation. Mantelas em paralelo
--      e source de drift entre tenants quando alguem grava via UI antiga.
--
-- A UI `/settings/loss-reasons` agora usa `/api/settings/org` e a chave
-- `deals.loss_reason_required`. O endpoint `/api/settings/system` ficou
-- restrito a super-admin EduIT e bloqueia chaves org-scoped.
--
-- Idempotencia: tudo via INSERT ... ON CONFLICT DO NOTHING e DELETE.
-- Re-rodar nao gera duplicatas nem destroi dados ja migrados.

-- ──────────────────────────────────────────────
-- 1) Backfill: loss_reason_required (global) -> deals.loss_reason_required (per-org)
-- ──────────────────────────────────────────────

INSERT INTO "organization_settings" ("id", "organizationId", "key", "value", "updatedAt")
SELECT
  'os_' || o."id" || '_deals_loss_reason_required',
  o."id",
  'deals.loss_reason_required',
  s."value",
  NOW()
FROM "organizations" o
CROSS JOIN "system_settings" s
WHERE s."key" = 'loss_reason_required'
ON CONFLICT ("organizationId", "key") DO NOTHING;

-- ──────────────────────────────────────────────
-- 2) Cleanup das chaves migradas em system_settings
-- ──────────────────────────────────────────────
-- Usamos DELETE em vez de DROP da tabela toda — system_settings ainda
-- segura chaves verdadeiramente globais (license keys, feature flags
-- cross-tenant da plataforma EduIT).

DELETE FROM "system_settings"
WHERE "key" = 'loss_reason_required'
   OR "key" LIKE 'visibility.%'
   OR "key" LIKE 'selfAssign.%';

-- ──────────────────────────────────────────────
-- 3) Defensa: comentario na tabela
-- ──────────────────────────────────────────────

COMMENT ON TABLE "system_settings" IS
  'Configuracoes GLOBAIS da plataforma EduIT (license keys, feature flags cross-tenant). NAO use para configs per-cliente — essas vao em organization_settings.';

COMMENT ON TABLE "organization_settings" IS
  'Configuracoes per-organizacao. Use lib/org-settings.ts (getOrgSetting/setOrgSetting). RLS isolado por tenant via app.organization_id.';
