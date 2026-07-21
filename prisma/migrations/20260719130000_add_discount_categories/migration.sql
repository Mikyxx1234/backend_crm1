-- ────────────────────────────────────────────────────────────────────────
-- Categorias de Desconto (Fase 2 do modelo de Cotas).
--
-- Introduz `discount_categories` como fonte da verdade de % + regras
-- (exclusionGroup, maxStacks, calcMode, vigencia). Cada categoria pode
-- ter N alocacoes de volume por unidade em `discount_quotas.categoryId`.
--
-- Aditivo: cotas legadas com `categoryId IS NULL` continuam usando as
-- proprias colunas (discountType/discountValue/etc.) — zero regressao.
--
-- Idempotente (IF NOT EXISTS) para poder rodar em ambientes que ja
-- possuem parte dos objetos.
-- ────────────────────────────────────────────────────────────────────────

-- discount_categories ----------------------------------------------------

CREATE TABLE IF NOT EXISTS "discount_categories" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "discountType"   "DiscountType" NOT NULL DEFAULT 'PERCENT',
  "discountValue"  DECIMAL(12,2) NOT NULL,
  "productId"      TEXT,
  "exclusionGroup" TEXT,
  "maxStacks"      INT NOT NULL DEFAULT 1,
  "calcMode"       "QuotaCalcMode" NOT NULL DEFAULT 'CASCADE',
  "validFrom"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validTo"        TIMESTAMP(3),
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "discount_categories_value_check"
    CHECK ("discountValue" > 0)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discount_categories_organizationId_fkey') THEN
    ALTER TABLE "discount_categories"
      ADD CONSTRAINT "discount_categories_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discount_categories_productId_fkey') THEN
    ALTER TABLE "discount_categories"
      ADD CONSTRAINT "discount_categories_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "discount_categories_organizationId_active_idx"
  ON "discount_categories" ("organizationId", "active");
CREATE INDEX IF NOT EXISTS "discount_categories_productId_idx"
  ON "discount_categories" ("productId");

-- discount_quotas.categoryId --------------------------------------------

ALTER TABLE "discount_quotas"
  ADD COLUMN IF NOT EXISTS "categoryId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discount_quotas_categoryId_fkey') THEN
    ALTER TABLE "discount_quotas"
      ADD CONSTRAINT "discount_quotas_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "discount_categories"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "discount_quotas_categoryId_idx"
  ON "discount_quotas" ("categoryId");
