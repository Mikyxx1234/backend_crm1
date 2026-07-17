-- Migration: add messenger_psid / instagram_igsid a `contacts` para integracao
-- de canais Facebook Messenger e Instagram Direct (Meta Messaging APIs).
ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "messenger_psid" TEXT,
  ADD COLUMN IF NOT EXISTS "instagram_igsid" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "contacts_organizationId_messenger_psid_key"
  ON "contacts" ("organizationId", "messenger_psid");

CREATE UNIQUE INDEX IF NOT EXISTS "contacts_organizationId_instagram_igsid_key"
  ON "contacts" ("organizationId", "instagram_igsid");
