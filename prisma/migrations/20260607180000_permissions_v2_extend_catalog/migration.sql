-- ─────────────────────────────────────────────────────────────────────────────
-- Permissions v2 (Sprint 1) — Extensão do catálogo
--
-- Adiciona novas permission keys aos roles com systemPreset = 'MANAGER' ou
-- 'MEMBER' nas orgs existentes. Idempotente: cada chave só é appendada se
-- ainda não estiver no array.
--
-- Política ADR-1: NUNCA remove chaves existentes — apenas adiciona. Roles
-- já em produção mantêm todas as keys legadas e ganham as novas.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  new_manager_keys TEXT[] := ARRAY[
    'deal:import', 'deal:export', 'deal:view_all',
    'conversation:view_all', 'conversation:view_unassigned',
    'conversation:assign', 'conversation:reassign',
    'conversation:close', 'conversation:reopen',
    'conversation:transfer', 'conversation:send_template',
    'conversation:send_media', 'conversation:view_internal_notes',
    'channel:whatsapp', 'channel:instagram', 'channel:email',
    'pipeline:view_cards_all', 'pipeline:move_cards',
    'contact:view_all',
    'company:export',
    'report:view_team', 'report:view_all',
    'settings:view', 'settings:pipelines', 'settings:import_export',
    'group:view', 'group:manage',
    'product:import', 'product:export',
    'price_table:view', 'price_table:manage',
    'contract:view_all', 'contract:manage', 'discount:approve',
    'data:view_phone', 'data:view_email'
  ];
  new_member_keys TEXT[] := ARRAY[
    'deal:view_own',
    'conversation:view_own', 'conversation:view_unassigned',
    'conversation:assign', 'conversation:close',
    'conversation:send_template', 'conversation:send_media',
    'channel:whatsapp',
    'pipeline:view_cards_own', 'pipeline:move_cards',
    'contact:view_own',
    'settings:view',
    'product:view', 'price_table:view', 'contract:view_own',
    'discount:request',
    'data:view_phone', 'data:view_email'
  ];
  k TEXT;
BEGIN
  -- MANAGER: appenda cada chave se ainda não estiver presente
  FOREACH k IN ARRAY new_manager_keys LOOP
    UPDATE roles
    SET permissions = array_append(permissions, k),
        "updatedAt" = NOW()
    WHERE "systemPreset" = 'MANAGER'
      AND NOT (permissions @> ARRAY[k]);
  END LOOP;

  -- MEMBER: idem
  FOREACH k IN ARRAY new_member_keys LOOP
    UPDATE roles
    SET permissions = array_append(permissions, k),
        "updatedAt" = NOW()
    WHERE "systemPreset" = 'MEMBER'
      AND NOT (permissions @> ARRAY[k]);
  END LOOP;
END $$;
