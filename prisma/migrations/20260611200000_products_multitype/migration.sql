-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('PHYSICAL', 'SERVICE', 'COURSE', 'JOB_OPENING');

-- CreateEnum
CREATE TYPE "InventoryConsumeTrigger" AS ENUM ('ON_WON', 'BY_AUTOMATION', 'MANUAL');

-- CreateEnum
CREATE TYPE "InventoryReason" AS ENUM ('SALE', 'RESTOCK', 'REVERSAL', 'RESERVATION', 'RESERVATION_RELEASE', 'HIRE', 'WITHDRAWAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ProductPlanInterval" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "CourseMode" AS ENUM ('EAD', 'IN_PERSON', 'HYBRID');

-- CreateEnum
CREATE TYPE "StakeholderChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "JobOpeningStatus" AS ENUM ('OPEN', 'PAUSED', 'FILLED', 'CLOSED');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "parentId" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "kind" "ProductKind" NOT NULL DEFAULT 'PHYSICAL';

-- CreateTable
CREATE TABLE "org_units" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_offers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountPct" DECIMAL(5,2),
    "conditions" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_pools" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "consumeTrigger" "InventoryConsumeTrigger" NOT NULL DEFAULT 'MANUAL',
    "allowNegative" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "InventoryReason" NOT NULL,
    "dealId" TEXT,
    "actorId" TEXT,
    "actorType" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_shipping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "weightGrams" INTEGER,
    "dimensions" JSONB,
    "shippingPolicy" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_shipping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_plans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "interval" "ProductPlanInterval" NOT NULL DEFAULT 'MONTHLY',
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_configs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mode" "CourseMode" NOT NULL DEFAULT 'EAD',
    "postSalePipelineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_classes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseConfigId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "location" TEXT,
    "poolId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_openings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT,
    "clientCompanyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "b2bDealId" TEXT,
    "candidatePipelineId" TEXT,
    "poolId" TEXT NOT NULL,
    "consumeStageId" TEXT,
    "reserveStageId" TEXT,
    "status" "JobOpeningStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_openings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_stakeholders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT,
    "jobOpeningId" TEXT,
    "contactId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "notifyOnSend" BOOLEAN NOT NULL DEFAULT false,
    "notifyForFeedback" BOOLEAN NOT NULL DEFAULT false,
    "channelPreference" "StakeholderChannel" NOT NULL DEFAULT 'WHATSAPP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_stakeholders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_units_organizationId_idx" ON "org_units"("organizationId");

-- CreateIndex
CREATE INDEX "org_units_organizationId_parentId_idx" ON "org_units"("organizationId", "parentId");

-- CreateIndex
CREATE INDEX "product_offers_organizationId_idx" ON "product_offers"("organizationId");

-- CreateIndex
CREATE INDEX "product_offers_productId_idx" ON "product_offers"("productId");

-- CreateIndex
CREATE INDEX "product_offers_orgUnitId_idx" ON "product_offers"("orgUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "product_offers_productId_orgUnitId_key" ON "product_offers"("productId", "orgUnitId");

-- CreateIndex
CREATE INDEX "inventory_pools_organizationId_idx" ON "inventory_pools"("organizationId");

-- CreateIndex
CREATE INDEX "inventory_pools_productId_idx" ON "inventory_pools"("productId");

-- CreateIndex
CREATE INDEX "inventory_pools_orgUnitId_idx" ON "inventory_pools"("orgUnitId");

-- CreateIndex
CREATE INDEX "inventory_movements_organizationId_idx" ON "inventory_movements"("organizationId");

-- CreateIndex
CREATE INDEX "inventory_movements_poolId_idx" ON "inventory_movements"("poolId");

-- CreateIndex
CREATE INDEX "inventory_movements_poolId_createdAt_idx" ON "inventory_movements"("poolId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_movements_dealId_idx" ON "inventory_movements"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "product_shipping_productId_key" ON "product_shipping"("productId");

-- CreateIndex
CREATE INDEX "product_shipping_organizationId_idx" ON "product_shipping"("organizationId");

-- CreateIndex
CREATE INDEX "product_plans_organizationId_idx" ON "product_plans"("organizationId");

-- CreateIndex
CREATE INDEX "product_plans_productId_idx" ON "product_plans"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "course_configs_productId_key" ON "course_configs"("productId");

-- CreateIndex
CREATE INDEX "course_configs_organizationId_idx" ON "course_configs"("organizationId");

-- CreateIndex
CREATE INDEX "course_classes_organizationId_idx" ON "course_classes"("organizationId");

-- CreateIndex
CREATE INDEX "course_classes_courseConfigId_idx" ON "course_classes"("courseConfigId");

-- CreateIndex
CREATE INDEX "job_openings_organizationId_idx" ON "job_openings"("organizationId");

-- CreateIndex
CREATE INDEX "job_openings_organizationId_status_idx" ON "job_openings"("organizationId", "status");

-- CreateIndex
CREATE INDEX "job_openings_clientCompanyId_idx" ON "job_openings"("clientCompanyId");

-- CreateIndex
CREATE INDEX "job_openings_poolId_idx" ON "job_openings"("poolId");

-- CreateIndex
CREATE INDEX "product_stakeholders_organizationId_idx" ON "product_stakeholders"("organizationId");

-- CreateIndex
CREATE INDEX "product_stakeholders_productId_idx" ON "product_stakeholders"("productId");

-- CreateIndex
CREATE INDEX "product_stakeholders_jobOpeningId_idx" ON "product_stakeholders"("jobOpeningId");

-- CreateIndex
CREATE INDEX "product_stakeholders_contactId_idx" ON "product_stakeholders"("contactId");

-- CreateIndex
CREATE INDEX "companies_organizationId_parentId_idx" ON "companies"("organizationId", "parentId");

-- CreateIndex
CREATE INDEX "products_organizationId_kind_idx" ON "products"("organizationId", "kind");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_offers" ADD CONSTRAINT "product_offers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_offers" ADD CONSTRAINT "product_offers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_offers" ADD CONSTRAINT "product_offers_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_pools" ADD CONSTRAINT "inventory_pools_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_pools" ADD CONSTRAINT "inventory_pools_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_pools" ADD CONSTRAINT "inventory_pools_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "inventory_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_shipping" ADD CONSTRAINT "product_shipping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_shipping" ADD CONSTRAINT "product_shipping_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_plans" ADD CONSTRAINT "product_plans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_plans" ADD CONSTRAINT "product_plans_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_configs" ADD CONSTRAINT "course_configs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_configs" ADD CONSTRAINT "course_configs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_classes" ADD CONSTRAINT "course_classes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_classes" ADD CONSTRAINT "course_classes_courseConfigId_fkey" FOREIGN KEY ("courseConfigId") REFERENCES "course_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_classes" ADD CONSTRAINT "course_classes_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "inventory_pools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_clientCompanyId_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "inventory_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stakeholders" ADD CONSTRAINT "product_stakeholders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stakeholders" ADD CONSTRAINT "product_stakeholders_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stakeholders" ADD CONSTRAINT "product_stakeholders_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "job_openings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stakeholders" ADD CONSTRAINT "product_stakeholders_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: produtos com `type` legado "SERVICE" recebem kind SERVICE.
-- Demais permanecem PHYSICAL (default da coluna).
UPDATE "products" SET "kind" = 'SERVICE' WHERE "type" = 'SERVICE';
