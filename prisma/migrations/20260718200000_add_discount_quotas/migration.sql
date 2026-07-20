-- ────────────────────────────────────────────────────────────────────────
-- Cotas de Desconto (PRD Cotas — Fase 1).
--
-- Adiciona:
--   * Enums: DiscountType, QuotaCalcMode, QuotaConsumeMoment,
--     DealQuotaStatus, QuotaMovementType.
--   * Tabelas: discount_quotas, quota_consumption_policies, deal_quotas,
--     quota_movements.
--   * Aditivos em deals: orgUnitId, priceFullSnapshot, priceFinalSnapshot
--     (nullable — zero regressão em deals legados).
--
-- Consumo atômico da cota (RN-06) fica no serviço de aplicação (UPDATE
-- condicional dentro de $transaction). Reconciliação usa quota_movements
-- como fonte de verdade.
--
-- Idempotente (IF NOT EXISTS) para poder rodar em ambientes que já
-- possuem parte dos objetos.
-- ────────────────────────────────────────────────────────────────────────

-- Enums -------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DiscountType') THEN
    CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'QuotaCalcMode') THEN
    CREATE TYPE "QuotaCalcMode" AS ENUM ('CASCADE', 'SUM_SIMPLE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'QuotaConsumeMoment') THEN
    CREATE TYPE "QuotaConsumeMoment" AS ENUM ('ON_WIN', 'ON_RESERVE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DealQuotaStatus') THEN
    CREATE TYPE "DealQuotaStatus" AS ENUM ('SELECTED', 'RESERVED', 'CONSUMED', 'RETURNED', 'EXPIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'QuotaMovementType') THEN
    CREATE TYPE "QuotaMovementType" AS ENUM ('RESERVE', 'CONSUME', 'RETURN', 'EXPIRE', 'MANUAL_ADJUST');
  END IF;
END $$;

-- Deal aditivos ----------------------------------------------------------

ALTER TABLE "deals"
  ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "deals"
  ADD COLUMN IF NOT EXISTS "priceFullSnapshot" DECIMAL(12,2);
ALTER TABLE "deals"
  ADD COLUMN IF NOT EXISTS "priceFinalSnapshot" DECIMAL(12,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deals_orgUnitId_fkey'
  ) THEN
    ALTER TABLE "deals"
      ADD CONSTRAINT "deals_orgUnitId_fkey"
      FOREIGN KEY ("orgUnitId") REFERENCES "org_units"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "deals_organizationId_orgUnitId_idx"
  ON "deals" ("organizationId", "orgUnitId");

-- discount_quotas --------------------------------------------------------

CREATE TABLE IF NOT EXISTS "discount_quotas" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "discountType"   "DiscountType" NOT NULL DEFAULT 'PERCENT',
  "discountValue"  DECIMAL(12,2) NOT NULL,
  "productId"      TEXT,
  "orgUnitId"      TEXT,
  "qtyTotal"       INT,
  "qtyConsumed"    INT NOT NULL DEFAULT 0,
  "validFrom"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validTo"        TIMESTAMP(3),
  "exclusionGroup" TEXT,
  "maxStacks"      INT NOT NULL DEFAULT 1,
  "calcMode"       "QuotaCalcMode" NOT NULL DEFAULT 'CASCADE',
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "discount_quotas_qty_check"
    CHECK ("qtyTotal" IS NULL OR "qtyConsumed" <= "qtyTotal"),
  CONSTRAINT "discount_quotas_value_check"
    CHECK ("discountValue" > 0)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discount_quotas_organizationId_fkey') THEN
    ALTER TABLE "discount_quotas"
      ADD CONSTRAINT "discount_quotas_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discount_quotas_productId_fkey') THEN
    ALTER TABLE "discount_quotas"
      ADD CONSTRAINT "discount_quotas_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discount_quotas_orgUnitId_fkey') THEN
    ALTER TABLE "discount_quotas"
      ADD CONSTRAINT "discount_quotas_orgUnitId_fkey"
      FOREIGN KEY ("orgUnitId") REFERENCES "org_units"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "discount_quotas_organizationId_active_idx"
  ON "discount_quotas" ("organizationId", "active");
CREATE INDEX IF NOT EXISTS "discount_quotas_scope_idx"
  ON "discount_quotas" ("organizationId", "productId", "orgUnitId", "active");
CREATE INDEX IF NOT EXISTS "discount_quotas_productId_idx"
  ON "discount_quotas" ("productId");
CREATE INDEX IF NOT EXISTS "discount_quotas_orgUnitId_idx"
  ON "discount_quotas" ("orgUnitId");

-- quota_consumption_policies ---------------------------------------------

CREATE TABLE IF NOT EXISTS "quota_consumption_policies" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "quotaId"          TEXT,
  "consumeMoment"    "QuotaConsumeMoment" NOT NULL DEFAULT 'ON_WIN',
  "reserveThreshold" INT,
  "reserveTtlHours"  INT NOT NULL DEFAULT 48,
  "active"           BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quota_consumption_policies_organizationId_fkey') THEN
    ALTER TABLE "quota_consumption_policies"
      ADD CONSTRAINT "quota_consumption_policies_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quota_consumption_policies_quotaId_fkey') THEN
    ALTER TABLE "quota_consumption_policies"
      ADD CONSTRAINT "quota_consumption_policies_quotaId_fkey"
      FOREIGN KEY ("quotaId") REFERENCES "discount_quotas"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Uma politica por cota especifica; a default (quotaId IS NULL) unica por org
-- (garantida no service, mas indexada para lookup).
CREATE UNIQUE INDEX IF NOT EXISTS "quota_consumption_policies_quotaId_key"
  ON "quota_consumption_policies" ("quotaId");
CREATE INDEX IF NOT EXISTS "quota_consumption_policies_organizationId_idx"
  ON "quota_consumption_policies" ("organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS "quota_consumption_policies_default_per_org"
  ON "quota_consumption_policies" ("organizationId")
  WHERE "quotaId" IS NULL AND "active";

-- deal_quotas ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "deal_quotas" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "dealId"         TEXT NOT NULL,
  "quotaId"        TEXT NOT NULL,
  "status"         "DealQuotaStatus" NOT NULL DEFAULT 'SELECTED',
  "valueSnapshot"  DECIMAL(12,2) NOT NULL,
  "typeSnapshot"   "DiscountType" NOT NULL,
  "reservedAt"     TIMESTAMP(3),
  "expiresAt"      TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deal_quotas_dealId_quotaId_key" UNIQUE ("dealId", "quotaId")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_quotas_organizationId_fkey') THEN
    ALTER TABLE "deal_quotas"
      ADD CONSTRAINT "deal_quotas_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_quotas_dealId_fkey') THEN
    ALTER TABLE "deal_quotas"
      ADD CONSTRAINT "deal_quotas_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "deals"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_quotas_quotaId_fkey') THEN
    ALTER TABLE "deal_quotas"
      ADD CONSTRAINT "deal_quotas_quotaId_fkey"
      FOREIGN KEY ("quotaId") REFERENCES "discount_quotas"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "deal_quotas_organizationId_idx"
  ON "deal_quotas" ("organizationId");
CREATE INDEX IF NOT EXISTS "deal_quotas_dealId_idx"
  ON "deal_quotas" ("dealId");
CREATE INDEX IF NOT EXISTS "deal_quotas_quotaId_idx"
  ON "deal_quotas" ("quotaId");
CREATE INDEX IF NOT EXISTS "deal_quotas_status_idx"
  ON "deal_quotas" ("status");

-- quota_movements --------------------------------------------------------

CREATE TABLE IF NOT EXISTS "quota_movements" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "quotaId"        TEXT NOT NULL,
  "dealId"         TEXT,
  "type"           "QuotaMovementType" NOT NULL,
  "qty"            INT NOT NULL DEFAULT 1,
  "userId"         TEXT,
  "reason"         TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quota_movements_organizationId_fkey') THEN
    ALTER TABLE "quota_movements"
      ADD CONSTRAINT "quota_movements_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quota_movements_quotaId_fkey') THEN
    ALTER TABLE "quota_movements"
      ADD CONSTRAINT "quota_movements_quotaId_fkey"
      FOREIGN KEY ("quotaId") REFERENCES "discount_quotas"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "quota_movements_organizationId_idx"
  ON "quota_movements" ("organizationId");
CREATE INDEX IF NOT EXISTS "quota_movements_quotaId_createdAt_idx"
  ON "quota_movements" ("quotaId", "createdAt");
CREATE INDEX IF NOT EXISTS "quota_movements_dealId_idx"
  ON "quota_movements" ("dealId");
