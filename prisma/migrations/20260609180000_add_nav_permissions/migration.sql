-- Permissões de navegação (sidebar principal) — `nav:<key>`.
-- migration-safety: ignore (apenas backfill idempotente em `roles.permissions`).
--
-- Contexto: a sidebar principal V2 (`NavRailV2`) passou a respeitar permissões
-- granulares por item (igual o menu de Settings já fazia). O catálogo TS
-- (`src/lib/authz/permissions.ts`) ganhou o resource `nav` com 1 action por
-- ícone da sidebar; presets (`src/lib/authz/presets.ts`) ganharam as `nav:*`
-- correspondentes ao comportamento atual.
--
-- Esta migration faz o BACKFILL nos roles MANAGER e MEMBER já existentes
-- (orgs em prod) — sem isso, no primeiro deploy esses usuários veriam a
-- sidebar VAZIA (fail-closed). ADMIN não precisa (`*`).
--
-- Também adiciona `settings:security` (chave usada por `settings-nav.ts` mas
-- ausente do catálogo) ao MANAGER quando ele já tem `settings:permissions`
-- — opcional, sem efeito em prod hoje (a rota só aceita SO_ADMIN no front).
--
-- Idempotência: o UPDATE concatena via `UNNEST` + `DISTINCT`, então re-rodar
-- não duplica entradas. Roles editados manualmente preservam o que já tinham
-- além das chaves novas.

-- ──────────────────────────────────────────────
-- 1) MANAGER: ganha TODAS as nav:* (paridade com allowedRoles atuais)
-- ──────────────────────────────────────────────

UPDATE "roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT k FROM UNNEST(
    "permissions" || ARRAY[
      'nav:dashboard', 'nav:pipeline', 'nav:contacts', 'nav:companies',
      'nav:inbox', 'nav:activities', 'nav:automations', 'nav:campaigns',
      'nav:distribution', 'nav:logs', 'nav:widgets'
    ]::TEXT[]
  ) AS k
),
"updatedAt" = NOW()
WHERE "systemPreset" = 'MANAGER';

-- ──────────────────────────────────────────────
-- 2) MEMBER: ganha as nav:* exceto automations/distribution/logs
--    (eram só ADMIN/MANAGER no `allowedRoles` antigo).
-- ──────────────────────────────────────────────

UPDATE "roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT k FROM UNNEST(
    "permissions" || ARRAY[
      'nav:dashboard', 'nav:pipeline', 'nav:contacts', 'nav:companies',
      'nav:inbox', 'nav:activities', 'nav:campaigns', 'nav:widgets'
    ]::TEXT[]
  ) AS k
),
"updatedAt" = NOW()
WHERE "systemPreset" = 'MEMBER';
