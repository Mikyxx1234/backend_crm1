-- CreateEnum
CREATE TYPE "WhatsappFlowStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "FlowFieldMappingTargetKind" AS ENUM ('CONTACT_NATIVE', 'CUSTOM_FIELD');

-- AlterTable
ALTER TABLE "whatsapp_template_configs" ADD COLUMN "operator_variables" JSONB;

-- CreateTable
CREATE TABLE "whatsapp_flow_definitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "WhatsappFlowStatus" NOT NULL DEFAULT 'DRAFT',
    "meta_flow_id" TEXT,
    "flow_category" TEXT NOT NULL DEFAULT 'LEAD_GENERATION',
    "generator_version" TEXT NOT NULL DEFAULT '1',
    "meta_json_version" TEXT,
    "published_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_flow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_flow_screens" (
    "id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,

    CONSTRAINT "whatsapp_flow_screens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_flow_fields" (
    "id" TEXT NOT NULL,
    "screen_id" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field_type" TEXT NOT NULL DEFAULT 'TEXT',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "whatsapp_flow_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_flow_field_mappings" (
    "id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "target_kind" "FlowFieldMappingTargetKind" NOT NULL,
    "native_key" TEXT,
    "custom_field_id" TEXT,

    CONSTRAINT "whatsapp_flow_field_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_flow_definitions_organizationId_idx" ON "whatsapp_flow_definitions"("organizationId");

-- CreateIndex
CREATE INDEX "whatsapp_flow_definitions_organizationId_status_idx" ON "whatsapp_flow_definitions"("organizationId", "status");

-- CreateIndex
CREATE INDEX "whatsapp_flow_screens_flow_id_idx" ON "whatsapp_flow_screens"("flow_id");

-- CreateIndex
CREATE INDEX "whatsapp_flow_fields_screen_id_idx" ON "whatsapp_flow_fields"("screen_id");

-- CreateIndex
CREATE INDEX "whatsapp_flow_field_mappings_custom_field_id_idx" ON "whatsapp_flow_field_mappings"("custom_field_id");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "whatsapp_flow_fields_screen_id_field_key_key" ON "whatsapp_flow_fields"("screen_id", "field_key");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "whatsapp_flow_field_mappings_field_id_key" ON "whatsapp_flow_field_mappings"("field_id");

-- AddForeignKey
ALTER TABLE "whatsapp_flow_definitions" ADD CONSTRAINT "whatsapp_flow_definitions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_flow_screens" ADD CONSTRAINT "whatsapp_flow_screens_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "whatsapp_flow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_flow_fields" ADD CONSTRAINT "whatsapp_flow_fields_screen_id_fkey" FOREIGN KEY ("screen_id") REFERENCES "whatsapp_flow_screens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_flow_field_mappings" ADD CONSTRAINT "whatsapp_flow_field_mappings_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "whatsapp_flow_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_flow_field_mappings" ADD CONSTRAINT "whatsapp_flow_field_mappings_custom_field_id_fkey" FOREIGN KEY ("custom_field_id") REFERENCES "custom_fields"("id") ON DELETE SET NULL ON UPDATE CASCADE;
