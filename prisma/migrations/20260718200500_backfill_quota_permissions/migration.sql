-- Backfill dos presets MANAGER e MEMBER com as novas permissions de Cotas.
--
-- Contexto (mesma convenção da migration 20260615120200_backfill_catalog_permissions):
-- ao adicionar novas keys em `src/lib/authz/presets.ts`, precisamos aplicar
-- o mesmo delta às orgs já existentes (roles.permissions é snapshot por org).
-- ADMIN não precisa (`*` cobre tudo).

UPDATE "roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT k FROM UNNEST(
    "permissions" || ARRAY[
      'quota:view',
      'quota:manage'
    ]::TEXT[]
  ) AS k
),
"updatedAt" = NOW()
WHERE "systemPreset" = 'MANAGER';

UPDATE "roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT k FROM UNNEST(
    "permissions" || ARRAY[
      'quota:view'
    ]::TEXT[]
  ) AS k
),
"updatedAt" = NOW()
WHERE "systemPreset" = 'MEMBER';
