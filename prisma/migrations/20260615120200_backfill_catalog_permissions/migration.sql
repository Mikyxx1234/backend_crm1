-- Backfill de permissions nos presets MANAGER e MEMBER de todas as orgs.
--
-- Contexto: a feature de Catálogo Universal por Capacidades + Inventário +
-- Vagas + Unidades + Stakeholders adicionou novos resources ao
-- PERMISSION_CATALOG e novas keys aos presets em `src/lib/authz/presets.ts`.
-- Como `roles.permissions` é snapshotada por organização, orgs criadas
-- ANTES dessa migração ficariam sem essas keys — fail-closed faria os
-- usuários não enxergarem Catálogo, Inventário, Vagas, Unidades, etc.
--
-- Esta migration faz o BACKFILL idempotente nas roles MANAGER e MEMBER
-- já existentes — mesmo pattern usado em
-- `20260609180000_add_nav_permissions/migration.sql` (UNNEST + DISTINCT).
-- ADMIN não precisa (`*` cobre tudo).
--
-- IMPORTANTE — convenção do projeto (presets.ts):
--   "Se voce alterar permissions de um preset aqui, EDITE TAMBEM o SQL e
--    crie uma migration de update se a alteracao precisar refletir em orgs
--    ja existentes."
-- Esta migration é justamente esse "update" que faltou.
--
-- Idempotência:
--   - UNNEST(permissions || ARRAY[...]) seguido de DISTINCT garante que
--     reaplicar não duplica entradas.
--   - Roles editados manualmente preservam o que já tinham (apenas
--     ganham as chaves novas).
--   - Custom roles (systemPreset IS NULL) não são tocados.

-- ──────────────────────────────────────────────────────────────────────
-- 1) MANAGER — ganha as 14 keys novas dos resources catalog/inventory/
--    job_opening/org_unit/product (manage_offers/manage_stakeholders).
-- ──────────────────────────────────────────────────────────────────────

UPDATE "roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT k FROM UNNEST(
    "permissions" || ARRAY[
      -- Produtos: gerenciamento avançado
      'product:manage_offers',
      'product:manage_stakeholders',
      -- Inventário / alocação
      'inventory:view',
      'inventory:adjust',
      -- Vagas (recrutamento)
      'job_opening:view',
      'job_opening:manage',
      'job_opening:close',
      -- Unidades (filiais)
      'org_unit:view',
      'org_unit:manage',
      -- Catálogo por capacidades
      'catalog:view',
      'catalog:create',
      'catalog:edit_capabilities',
      'catalog:delete',
      'catalog:save_as_template'
    ]::TEXT[]
  ) AS k
),
"updatedAt" = NOW()
WHERE "systemPreset" = 'MANAGER';

-- ──────────────────────────────────────────────────────────────────────
-- 2) MEMBER — ganha as 5 keys de visualização (sem ações destrutivas).
-- ──────────────────────────────────────────────────────────────────────

UPDATE "roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT k FROM UNNEST(
    "permissions" || ARRAY[
      'product:view',
      'inventory:view',
      'job_opening:view',
      'org_unit:view',
      'catalog:view'
    ]::TEXT[]
  ) AS k
),
"updatedAt" = NOW()
WHERE "systemPreset" = 'MEMBER';
