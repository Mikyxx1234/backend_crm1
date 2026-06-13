-- Migration: Catálogo Universal por Capacidades (PRD catalogo-capacidades), Fase 1.
-- 100% aditiva. Idempotente (IF NOT EXISTS / DO blocks) para aplicação manual
-- em dev e prod (SKIP_PRISMA_MIGRATE=1; nunca `migrate deploy` em prod).
--
-- NOTA: este arquivo contém SOMENTE o delta da Fase 1. O `migrate diff` também
-- reportou drift pré-existente do banco de dev (channels.defaultPipelineId,
-- contacts.number) que NÃO pertence a esta feature e foi removido de propósito.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DealRole" AS ENUM ('COMMERCIAL', 'OPERATIONAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DealLinkType" AS ENUM ('ORIGINATED', 'RELATED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AlterEnum: alias agnóstico do PRD para liberação de reserva.
DO $$ BEGIN
  ALTER TYPE "InventoryReason" ADD VALUE IF NOT EXISTS 'RELEASE';
EXCEPTION WHEN others THEN null; END $$;

-- AlterTable
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "dealRole" "DealRole" NOT NULL DEFAULT 'COMMERCIAL';

-- AlterTable
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "catalogId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "catalogs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "templateKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "catalog_capabilities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "capabilityKey" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "product_capabilities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "capabilityKey" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "capacity_slots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "resourceRef" TEXT,
    "poolId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capacity_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "shipping_ranges" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productShippingId" TEXT NOT NULL,
    "zipFrom" TEXT NOT NULL,
    "zipTo" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "leadDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "stakeholder_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT,
    "event" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "templateRef" TEXT,
    "channel" "StakeholderChannel" NOT NULL DEFAULT 'WHATSAPP',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stakeholder_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "deal_links" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromDealId" TEXT NOT NULL,
    "toDealId" TEXT NOT NULL,
    "linkType" "DealLinkType" NOT NULL DEFAULT 'ORIGINATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "catalogs_organizationId_idx" ON "catalogs"("organizationId");
CREATE INDEX IF NOT EXISTS "catalogs_organizationId_isDefault_idx" ON "catalogs"("organizationId", "isDefault");
CREATE INDEX IF NOT EXISTS "catalogs_organizationId_isTemplate_idx" ON "catalogs"("organizationId", "isTemplate");
CREATE INDEX IF NOT EXISTS "catalog_capabilities_organizationId_idx" ON "catalog_capabilities"("organizationId");
CREATE INDEX IF NOT EXISTS "catalog_capabilities_catalogId_idx" ON "catalog_capabilities"("catalogId");
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_capabilities_catalogId_capabilityKey_key" ON "catalog_capabilities"("catalogId", "capabilityKey");
CREATE INDEX IF NOT EXISTS "product_capabilities_organizationId_idx" ON "product_capabilities"("organizationId");
CREATE INDEX IF NOT EXISTS "product_capabilities_productId_idx" ON "product_capabilities"("productId");
CREATE UNIQUE INDEX IF NOT EXISTS "product_capabilities_productId_capabilityKey_key" ON "product_capabilities"("productId", "capabilityKey");
CREATE UNIQUE INDEX IF NOT EXISTS "capacity_slots_poolId_key" ON "capacity_slots"("poolId");
CREATE INDEX IF NOT EXISTS "capacity_slots_organizationId_idx" ON "capacity_slots"("organizationId");
CREATE INDEX IF NOT EXISTS "capacity_slots_productId_idx" ON "capacity_slots"("productId");
CREATE INDEX IF NOT EXISTS "capacity_slots_organizationId_startsAt_idx" ON "capacity_slots"("organizationId", "startsAt");
CREATE INDEX IF NOT EXISTS "shipping_ranges_organizationId_idx" ON "shipping_ranges"("organizationId");
CREATE INDEX IF NOT EXISTS "shipping_ranges_productShippingId_idx" ON "shipping_ranges"("productShippingId");
CREATE INDEX IF NOT EXISTS "stakeholder_rules_organizationId_idx" ON "stakeholder_rules"("organizationId");
CREATE INDEX IF NOT EXISTS "stakeholder_rules_productId_idx" ON "stakeholder_rules"("productId");
CREATE INDEX IF NOT EXISTS "stakeholder_rules_organizationId_event_idx" ON "stakeholder_rules"("organizationId", "event");
CREATE INDEX IF NOT EXISTS "deal_links_organizationId_idx" ON "deal_links"("organizationId");
CREATE INDEX IF NOT EXISTS "deal_links_fromDealId_idx" ON "deal_links"("fromDealId");
CREATE INDEX IF NOT EXISTS "deal_links_toDealId_idx" ON "deal_links"("toDealId");
CREATE UNIQUE INDEX IF NOT EXISTS "deal_links_fromDealId_toDealId_linkType_key" ON "deal_links"("fromDealId", "toDealId", "linkType");
CREATE INDEX IF NOT EXISTS "deals_organizationId_dealRole_idx" ON "deals"("organizationId", "dealRole");
CREATE INDEX IF NOT EXISTS "products_organizationId_catalogId_idx" ON "products"("organizationId", "catalogId");

-- AddForeignKey (guarded — Postgres não tem ADD CONSTRAINT IF NOT EXISTS)
DO $$ BEGIN
  ALTER TABLE "products" ADD CONSTRAINT "products_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "catalogs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "catalog_capabilities" ADD CONSTRAINT "catalog_capabilities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "catalog_capabilities" ADD CONSTRAINT "catalog_capabilities_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "product_capabilities" ADD CONSTRAINT "product_capabilities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "product_capabilities" ADD CONSTRAINT "product_capabilities_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "capacity_slots" ADD CONSTRAINT "capacity_slots_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "capacity_slots" ADD CONSTRAINT "capacity_slots_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "capacity_slots" ADD CONSTRAINT "capacity_slots_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "inventory_pools"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "shipping_ranges" ADD CONSTRAINT "shipping_ranges_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "shipping_ranges" ADD CONSTRAINT "shipping_ranges_productShippingId_fkey" FOREIGN KEY ("productShippingId") REFERENCES "product_shipping"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "stakeholder_rules" ADD CONSTRAINT "stakeholder_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "stakeholder_rules" ADD CONSTRAINT "stakeholder_rules_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "deal_links" ADD CONSTRAINT "deal_links_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "deal_links" ADD CONSTRAINT "deal_links_fromDealId_fkey" FOREIGN KEY ("fromDealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "deal_links" ADD CONSTRAINT "deal_links_toDealId_fkey" FOREIGN KEY ("toDealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Backfill: catálogo default por organização + mover produtos legados pra ele
-- + ligar capability `pricing` (PRD §10: produtos atuais migram para catálogo default).
DO $$
DECLARE
  org RECORD;
  new_catalog_id TEXT;
BEGIN
  FOR org IN SELECT id FROM "organizations" LOOP
    -- Cria catálogo default se a org ainda não tem nenhum.
    IF NOT EXISTS (SELECT 1 FROM "catalogs" WHERE "organizationId" = org.id AND "isDefault" = true) THEN
      new_catalog_id := gen_random_uuid()::text;
      INSERT INTO "catalogs" ("id", "organizationId", "name", "description", "isDefault", "isTemplate", "createdAt", "updatedAt")
      VALUES (new_catalog_id, org.id, 'Catálogo padrão', 'Catálogo default criado na migração de capacidades.', true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

      -- Liga a capability pricing ao catálogo default.
      INSERT INTO "catalog_capabilities" ("id", "organizationId", "catalogId", "capabilityKey", "config", "enabled", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, org.id, new_catalog_id, 'pricing', '{}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

      -- Move produtos da org sem catálogo para o default.
      UPDATE "products" SET "catalogId" = new_catalog_id
      WHERE "organizationId" = org.id AND "catalogId" IS NULL;
    END IF;
  END LOOP;
END $$;
