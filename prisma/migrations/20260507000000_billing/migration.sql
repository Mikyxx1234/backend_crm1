-- ============================================================
-- Billing: OrganizationSubscription + UsageRecord (PR 6.3)
-- ============================================================
-- Cria tabelas para metered billing via Stripe e usage tracking
-- append-only por organization. Aplica RLS para isolamento
-- multi-tenant (PR 1.4 — qualquer query feita pelo Prisma scoped
-- so ve rows do `app.current_org_id`).
--
-- Migration backwards-compatible: tabelas novas, nenhum schema
-- existente alterado. Pode ser revertida apenas DROP.
-- ============================================================

-- ── SubscriptionStatus enum ─────────────────────────────────
CREATE TYPE "SubscriptionStatus" AS ENUM (
    'ACTIVE',
    'TRIALING',
    'PAST_DUE',
    'UNPAID',
    'CANCELED'
);

-- ── organization_subscriptions ──────────────────────────────
CREATE TABLE "organization_subscriptions" (
    "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId" TEXT NOT NULL UNIQUE,
    "planKey" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "stripeCustomerId" TEXT UNIQUE,
    "stripeSubscriptionId" TEXT UNIQUE,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT FALSE,
    "limitsOverride" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_subscriptions_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "organization_subscriptions_planKey_idx"
    ON "organization_subscriptions"("planKey");
CREATE INDEX "organization_subscriptions_status_idx"
    ON "organization_subscriptions"("status");

-- ── usage_records ───────────────────────────────────────────
-- Append-only: nunca UPDATE exceto `reportedAt` apos sync com Stripe.
-- BIGINT em `amount` cobre tokens/bytes ate ~9 quintilhoes — suficiente.
CREATE TABLE "usage_records" (
    "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId" TEXT NOT NULL,
    "meter" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceId" TEXT,
    "reportedAt" TIMESTAMP(3),
    "reportIdempKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- Hot path: consultar uso por org+meter no periodo atual.
CREATE INDEX "usage_records_organizationId_meter_occurredAt_idx"
    ON "usage_records"("organizationId", "meter", "occurredAt");

-- Aggregator: scan de rows nao-reportadas por org.
CREATE INDEX "usage_records_organizationId_reportedAt_idx"
    ON "usage_records"("organizationId", "reportedAt");

-- Cron de sync: scan global de rows nao-reportadas por meter.
CREATE INDEX "usage_records_meter_reportedAt_idx"
    ON "usage_records"("meter", "reportedAt");

-- ============================================================
-- RLS — multi-tenant isolation
-- ============================================================
-- Mesma estrategia da PR 1.4: policy compara organizationId com
-- `app.current_org_id` (setado pela Prisma extension via SET LOCAL),
-- ou bypass para super-admin (`app.is_super_admin = true`).

ALTER TABLE "organization_subscriptions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organization_subscriptions_tenant_isolation"
    ON "organization_subscriptions"
    USING (
        current_setting('app.is_super_admin', true) = 'true'
        OR "organizationId" = current_setting('app.current_org_id', true)
    )
    WITH CHECK (
        current_setting('app.is_super_admin', true) = 'true'
        OR "organizationId" = current_setting('app.current_org_id', true)
    );

ALTER TABLE "usage_records" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_records_tenant_isolation"
    ON "usage_records"
    USING (
        current_setting('app.is_super_admin', true) = 'true'
        OR "organizationId" = current_setting('app.current_org_id', true)
    )
    WITH CHECK (
        current_setting('app.is_super_admin', true) = 'true'
        OR "organizationId" = current_setting('app.current_org_id', true)
    );
