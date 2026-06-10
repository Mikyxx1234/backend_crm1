-- Marketplace de widgets (modelo Zendesk/Pipedrive)
--
-- Cria:
--   1) Enums `WidgetOwnerType` e `WidgetStatus`.
--   2) Tabela `partner_accounts` (contas de parceiros — separadas de `users`).
--   3) Tabela `widgets` (catalogo global de widgets internos + parceiros).
--   4) Seed dos 2 widgets internos historicos (`smart_distribution`, `ai_agents`)
--      para casar com `organization_widgets.widgetSlug` que ja existe em prod.
--
-- `organization_widgets` permanece intacto: continua armazenando o estado
-- de instalacao por org via `widgetSlug` (referencia logica, sem FK Prisma
-- pra manter tenant-scope limpo).

-- ──────────────────────────────────────────────
-- 1) Enums
-- ──────────────────────────────────────────────

CREATE TYPE "WidgetOwnerType" AS ENUM ('INTERNAL', 'PARTNER');
CREATE TYPE "WidgetStatus"   AS ENUM ('DRAFT', 'ONLINE', 'OFFLINE');

-- ──────────────────────────────────────────────
-- 2) partner_accounts
-- ──────────────────────────────────────────────

CREATE TABLE "partner_accounts" (
  "id"           TEXT NOT NULL,
  "email"        TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_accounts_email_key" ON "partner_accounts" ("email");

-- ──────────────────────────────────────────────
-- 3) widgets
-- ──────────────────────────────────────────────

CREATE TABLE "widgets" (
  "id"               TEXT NOT NULL,
  "slug"             TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "description"      TEXT NOT NULL,
  "icon"             TEXT NOT NULL,
  "category"         TEXT NOT NULL,
  "ownerType"        "WidgetOwnerType" NOT NULL,
  "partnerAccountId" TEXT,
  "iframeUrl"        TEXT,
  "availability"     TEXT NOT NULL DEFAULT 'available',
  "status"           "WidgetStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "widgets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "widgets_slug_key"            ON "widgets" ("slug");
CREATE        INDEX "widgets_status_idx"          ON "widgets" ("status");
CREATE        INDEX "widgets_partnerAccountId_idx" ON "widgets" ("partnerAccountId");

ALTER TABLE "widgets"
  ADD CONSTRAINT "widgets_partnerAccountId_fkey"
  FOREIGN KEY ("partnerAccountId") REFERENCES "partner_accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────
-- 4) Seed dos widgets internos historicos
--
-- Idempotente: usa ON CONFLICT pra nao quebrar em re-run / ambientes
-- que ja rodaram a migration. Slugs casam exatamente com os que viviam
-- em `widget-catalog.ts` (preservando `organization_widgets.widgetSlug`).
-- ──────────────────────────────────────────────

INSERT INTO "widgets" (
  "id", "slug", "name", "description", "icon", "category",
  "ownerType", "availability", "status", "createdAt", "updatedAt"
) VALUES
  (
    'c' || replace(gen_random_uuid()::text, '-', ''),
    'smart_distribution',
    'Distribuição Inteligente',
    'Automatize a distribuição de leads entre consultores usando regras inteligentes, disponibilidade, fila, prioridade e equilíbrio operacional.',
    'route',
    'Operação Comercial',
    'INTERNAL',
    'available',
    'ONLINE',
    NOW(),
    NOW()
  ),
  (
    'c' || replace(gen_random_uuid()::text, '-', ''),
    'ai_agents',
    'Agentes de IA',
    'Configure agentes de IA para atendimento, qualificação, recomendação de cursos, reativação de leads e automações conversacionais dentro do CRM.',
    'bot',
    'Inteligência Artificial',
    'INTERNAL',
    'available',
    'ONLINE',
    NOW(),
    NOW()
  )
ON CONFLICT ("slug") DO NOTHING;
