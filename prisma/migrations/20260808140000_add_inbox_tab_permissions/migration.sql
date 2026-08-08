-- Permissões de filas da Inbox — `inbox:tab:<id>`.
-- migration-safety: ignore (apenas backfill idempotente em `roles.permissions`).
--
-- Contexto: operadores (MEMBER) viam abas Entrada/Automação vazias porque a
-- visibilidade era own-only e não havia keys por fila. Orgs promoviam a
-- ADMIN só para "ver filas". Agora cada aba é uma permission key; presets
-- MEMBER recebem só Aguardando+Respondidas; MANAGER recebe todas.
--
-- Pattern: mesmo de `20260609180000_add_nav_permissions` (UNNEST + DISTINCT).
-- ADMIN não precisa (`*`). Custom roles (systemPreset IS NULL) não são tocados.

-- ──────────────────────────────────────────────
-- 1) MANAGER: todas as filas da Inbox
-- ──────────────────────────────────────────────

UPDATE "roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT k FROM UNNEST(
    "permissions" || ARRAY[
      'inbox:tab:entrada',
      'inbox:tab:esperando',
      'inbox:tab:respondidas',
      'inbox:tab:automacao',
      'inbox:tab:finalizados',
      'inbox:tab:erro'
    ]::TEXT[]
  ) AS k
),
"updatedAt" = NOW()
WHERE "systemPreset" = 'MANAGER';

-- ──────────────────────────────────────────────
-- 2) MEMBER: só Aguardando + Respondidas (default operacional)
-- ──────────────────────────────────────────────

UPDATE "roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT k FROM UNNEST(
    "permissions" || ARRAY[
      'inbox:tab:esperando',
      'inbox:tab:respondidas'
    ]::TEXT[]
  ) AS k
),
"updatedAt" = NOW()
WHERE "systemPreset" = 'MEMBER';
