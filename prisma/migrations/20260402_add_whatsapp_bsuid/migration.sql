-- WhatsApp business-scoped user ID (BSUID). Ref:
-- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids

ALTER TABLE "contacts" ADD COLUMN "whatsapp_bsuid" TEXT;

CREATE UNIQUE INDEX "contacts_whatsapp_bsuid_key" ON "contacts"("whatsapp_bsuid");
