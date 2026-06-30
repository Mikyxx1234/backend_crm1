-- Telefonia como widget (`calls_history`).
--
-- Objetivo: transformar o módulo de Telefonia (softphone integrado,
-- histórico de chamadas em /widgets/calls e botão de ligar nos cards do
-- pipeline) em um widget plugável da Central de Widgets — mesmo padrão da
-- Distribuição Inteligente (`smart_distribution`).
--
-- COMPATIBILIDADE — passo crítico: instalamos o widget ACTIVE em TODAS as
-- orgs existentes (idempotente via ON CONFLICT DO NOTHING). Sem esse
-- backfill, qualquer org que já usa telefonia hoje veria o softphone
-- sumir após o deploy, o que seria uma quebra silenciosa.
-- Admins que NÃO querem telefonia podem desinstalar normalmente em
-- /widgets depois do deploy.
--
-- migration-safety: ignore (catalogo + seed de installations idempotente;
-- não altera schema; não toca em dados de chamadas existentes).

-- ============================================================
-- 1) Catalogo: insere o widget `calls_history` na tabela global
-- ============================================================
INSERT INTO "widgets" (
  "id", "slug", "name", "description", "icon", "category",
  "ownerType", "availability", "status", "createdAt", "updatedAt"
) VALUES (
  'c' || replace(gen_random_uuid()::text, '-', ''),
  'calls_history',
  'Ligações',
  'Softphone integrado (Api4Com / SIP), histórico de chamadas e botão de ligar nos cards do pipeline. Inclui captura automática de gravações via webhook.',
  'phone',
  'Comunicação',
  'INTERNAL',
  'available',
  'ONLINE',
  NOW(),
  NOW()
)
ON CONFLICT ("slug") DO NOTHING;

-- ============================================================
-- 2) Permissão nav:calls — concede aos presets MANAGER e MEMBER
-- ============================================================
-- ADMIN já tem '*' (coberto por `can()`). MANAGER e MEMBER ganham a
-- permissão pra ver o item "Chamadas" na sidebar (gateado via
-- `requiredPermission`). Idempotente; nao remove nada.
UPDATE "roles"
SET "permissions" = "permissions" || ARRAY['nav:calls'],
    "updatedAt" = NOW()
WHERE "systemPreset" IN ('MANAGER', 'MEMBER')
  AND NOT ('nav:calls' = ANY("permissions"));

-- ============================================================
-- 3) Backfill — instala ACTIVE para TODAS as orgs existentes
-- ============================================================
-- ID determinístico (`ow_<orgId>_calls_history`) pra ON CONFLICT funcionar
-- mesmo se a migration rodar parcialmente e precisar ser reaplicada. O
-- conflict key (`organizationId`, `widgetSlug`) é unique no schema.
INSERT INTO "organization_widgets"
  ("id", "organizationId", "widgetSlug", "status", "installedById", "config", "installedAt", "createdAt", "updatedAt")
SELECT
  'ow_' || o."id" || '_calls_history',
  o."id",
  'calls_history',
  'ACTIVE',
  NULL,
  NULL::jsonb,
  NOW(),
  NOW(),
  NOW()
FROM "organizations" o
ON CONFLICT ("organizationId", "widgetSlug") DO NOTHING;
