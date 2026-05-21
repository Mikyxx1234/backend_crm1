-- AlterTable: UTMs estruturados extraídos do url_tags do Ad (Marketing API)
ALTER TABLE "contacts"
  ADD COLUMN "ad_utm_source"   TEXT,
  ADD COLUMN "ad_utm_medium"   TEXT,
  ADD COLUMN "ad_utm_campaign" TEXT,
  ADD COLUMN "ad_utm_content"  TEXT,
  ADD COLUMN "ad_utm_term"     TEXT;

-- Índices para agrupamento/filtro futuro (relatórios por campanha/origem)
CREATE INDEX "contacts_ad_utm_source_idx"   ON "contacts"("ad_utm_source");
CREATE INDEX "contacts_ad_utm_campaign_idx" ON "contacts"("ad_utm_campaign");
