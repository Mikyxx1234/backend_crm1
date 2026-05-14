ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "ad_source_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "ad_source_type" TEXT,
  ADD COLUMN IF NOT EXISTS "ad_ctwa_clid"   TEXT,
  ADD COLUMN IF NOT EXISTS "ad_headline"    TEXT;

CREATE INDEX IF NOT EXISTS "contacts_ad_source_id_idx"
  ON "contacts"("ad_source_id");

CREATE INDEX IF NOT EXISTS "contacts_ad_ctwa_clid_idx"
  ON "contacts"("ad_ctwa_clid");
