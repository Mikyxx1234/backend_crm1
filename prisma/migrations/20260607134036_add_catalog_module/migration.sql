-- ========================================================================
--  Módulo Catálogo Comercial — schema aditivo (NÃO destrutivo).
--  Evolui Product e DealProduct, e cria PriceTable, PriceTableItem,
--  Contract, ContractItem, StockMovement, DiscountRequest.
--
--  Estratégia: todos os ALTER usam IF NOT EXISTS / CREATE TABLE IF NOT
--  EXISTS — a migration pode ser reaplicada sem efeitos colaterais
--  (mesmo padrão de 20260602000000_add_product_stock e
--  20260601000005_add_custom_field_highlight_rules).
--
--  IMPORTANTE: não rodar com `migrate dev` em DB compartilhado/prod —
--  apenas `migrate deploy` ou `db execute --file` direto.
-- ========================================================================

-- ─── Product (campos novos) ─────────────────────────────────────────────
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "code"                       TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "attributes"                 JSONB;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "discount_max"               DECIMAL(5,2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "discount_requires_approval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock_alert_at"             DECIMAL(12,2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock_reserved"             DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "products_organizationId_code_idx" ON "products" ("organizationId", "code");

-- ─── DealProduct (campos novos) ─────────────────────────────────────────
ALTER TABLE "deal_products" ADD COLUMN IF NOT EXISTS "discount_requested"      DECIMAL(5,2) DEFAULT 0;
ALTER TABLE "deal_products" ADD COLUMN IF NOT EXISTS "discount_status"         TEXT NOT NULL DEFAULT 'NA';
ALTER TABLE "deal_products" ADD COLUMN IF NOT EXISTS "discount_note"           TEXT;
ALTER TABLE "deal_products" ADD COLUMN IF NOT EXISTS "discount_approved_by_id" TEXT;
ALTER TABLE "deal_products" ADD COLUMN IF NOT EXISTS "discount_approved_at"    TIMESTAMP(3);

DO $$ BEGIN
  ALTER TABLE "deal_products"
    ADD CONSTRAINT "deal_products_discount_approved_by_id_fkey"
    FOREIGN KEY ("discount_approved_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "deal_products_organizationId_discount_status_idx"
  ON "deal_products" ("organizationId", "discount_status");

-- ─── PriceTable ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "price_tables" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "description"    TEXT,
  "is_default"     BOOLEAN NOT NULL DEFAULT false,
  "is_active"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "price_tables_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "price_tables"
    ADD CONSTRAINT "price_tables_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "price_tables_organizationId_idx"            ON "price_tables" ("organizationId");
CREATE INDEX IF NOT EXISTS "price_tables_organizationId_is_active_idx"  ON "price_tables" ("organizationId", "is_active");

-- ─── PriceTableItem ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "price_table_items" (
  "id"             TEXT NOT NULL,
  "price_table_id" TEXT NOT NULL,
  "product_id"     TEXT NOT NULL,
  "price"          DECIMAL(12,2) NOT NULL,
  "discount_max"   DECIMAL(5,2),
  "valid_from"     TIMESTAMP(3),
  "valid_until"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "price_table_items_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "price_table_items"
    ADD CONSTRAINT "price_table_items_price_table_id_fkey"
    FOREIGN KEY ("price_table_id") REFERENCES "price_tables"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "price_table_items"
    ADD CONSTRAINT "price_table_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "price_table_items_price_table_id_product_id_key"
  ON "price_table_items" ("price_table_id", "product_id");
CREATE INDEX IF NOT EXISTS "price_table_items_price_table_id_idx" ON "price_table_items" ("price_table_id");
CREATE INDEX IF NOT EXISTS "price_table_items_product_id_idx"     ON "price_table_items" ("product_id");

-- ─── Contract ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "contracts" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "deal_id"        TEXT,
  "company_id"     TEXT,
  "contact_id"     TEXT,
  "price_table_id" TEXT,
  "owner_id"       TEXT,
  "code"           TEXT,
  "status"         TEXT NOT NULL DEFAULT 'ACTIVE',
  "start_date"     TIMESTAMP(3),
  "end_date"       TIMESTAMP(3),
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "contracts" ADD CONSTRAINT "contracts_deal_id_fkey"
    FOREIGN KEY ("deal_id") REFERENCES "deals"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "contracts" ADD CONSTRAINT "contracts_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "contracts" ADD CONSTRAINT "contracts_price_table_id_fkey"
    FOREIGN KEY ("price_table_id") REFERENCES "price_tables"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "contracts" ADD CONSTRAINT "contracts_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "contracts_organizationId_idx"          ON "contracts" ("organizationId");
CREATE INDEX IF NOT EXISTS "contracts_organizationId_status_idx"   ON "contracts" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "contracts_deal_id_idx"                 ON "contracts" ("deal_id");
CREATE INDEX IF NOT EXISTS "contracts_company_id_idx"              ON "contracts" ("company_id");
CREATE INDEX IF NOT EXISTS "contracts_contact_id_idx"              ON "contracts" ("contact_id");

-- ─── ContractItem ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "contract_items" (
  "id"          TEXT NOT NULL,
  "contract_id" TEXT NOT NULL,
  "product_id"  TEXT NOT NULL,
  "quantity"    DECIMAL(12,2) NOT NULL,
  "unit_price"  DECIMAL(12,2) NOT NULL,
  "discount"    DECIMAL(5,2) NOT NULL DEFAULT 0,
  "balance"     DECIMAL(12,2) NOT NULL,
  "consumed"    DECIMAL(12,2) NOT NULL DEFAULT 0,
  "reserved"    DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contract_items_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "contract_items_contract_id_idx" ON "contract_items" ("contract_id");
CREATE INDEX IF NOT EXISTS "contract_items_product_id_idx"  ON "contract_items" ("product_id");

-- ─── StockMovement ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "stock_movements" (
  "id"              TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "product_id"      TEXT NOT NULL,
  "contract_id"     TEXT,
  "deal_id"         TEXT,
  "user_id"         TEXT,
  "type"            TEXT NOT NULL,
  "quantity"        DECIMAL(12,2) NOT NULL,
  "balance_after"   DECIMAL(12,2) NOT NULL,
  "reason"          TEXT,
  "metadata"        JSONB,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_deal_id_fkey"
    FOREIGN KEY ("deal_id") REFERENCES "deals"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "stock_movements_organization_id_idx"             ON "stock_movements" ("organization_id");
CREATE INDEX IF NOT EXISTS "stock_movements_organization_id_createdAt_idx"   ON "stock_movements" ("organization_id", "createdAt");
CREATE INDEX IF NOT EXISTS "stock_movements_product_id_idx"                  ON "stock_movements" ("product_id");
CREATE INDEX IF NOT EXISTS "stock_movements_contract_id_idx"                 ON "stock_movements" ("contract_id");
CREATE INDEX IF NOT EXISTS "stock_movements_deal_id_idx"                     ON "stock_movements" ("deal_id");

-- ─── DiscountRequest ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "discount_requests" (
  "id"                 TEXT NOT NULL,
  "organization_id"    TEXT NOT NULL,
  "deal_product_id"    TEXT NOT NULL,
  "product_id"         TEXT NOT NULL,
  "requested_by_id"    TEXT NOT NULL,
  "approved_by_id"     TEXT,
  "discount_requested" DECIMAL(5,2) NOT NULL,
  "discount_max"       DECIMAL(5,2) NOT NULL,
  "status"             TEXT NOT NULL DEFAULT 'PENDING',
  "note"               TEXT,
  "review_note"        TEXT,
  "resolved_at"        TIMESTAMP(3),
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "discount_requests_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_deal_product_id_fkey"
    FOREIGN KEY ("deal_product_id") REFERENCES "deal_products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_requested_by_id_fkey"
    FOREIGN KEY ("requested_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_approved_by_id_fkey"
    FOREIGN KEY ("approved_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "discount_requests_organization_id_idx"          ON "discount_requests" ("organization_id");
CREATE INDEX IF NOT EXISTS "discount_requests_organization_id_status_idx"   ON "discount_requests" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "discount_requests_deal_product_id_idx"          ON "discount_requests" ("deal_product_id");
