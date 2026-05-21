-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "ad_resolved_id" TEXT;
ALTER TABLE "contacts" ADD COLUMN "ad_resolved_name" TEXT;
ALTER TABLE "contacts" ADD COLUMN "ad_resolved_adset_id" TEXT;
ALTER TABLE "contacts" ADD COLUMN "ad_resolved_adset_name" TEXT;
ALTER TABLE "contacts" ADD COLUMN "ad_resolved_campaign_id" TEXT;
ALTER TABLE "contacts" ADD COLUMN "ad_resolved_campaign_name" TEXT;
ALTER TABLE "contacts" ADD COLUMN "ad_resolved_at" TIMESTAMP(3);
ALTER TABLE "contacts" ADD COLUMN "ad_resolve_status" TEXT;
ALTER TABLE "contacts" ADD COLUMN "ad_resolve_error" TEXT;

-- CreateIndex (busca rápida por ad/campanha resolvidos)
CREATE INDEX "contacts_organizationId_ad_resolved_id_idx"
  ON "contacts"("organizationId", "ad_resolved_id");
CREATE INDEX "contacts_organizationId_ad_resolved_campaign_id_idx"
  ON "contacts"("organizationId", "ad_resolved_campaign_id");
