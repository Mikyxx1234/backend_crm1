-- Histórico imutável de troca de número do cliente.
--
-- Origem principal: webhook Meta WhatsApp Cloud API dispara um evento
-- `messages[].type = "system"` com `system.type = "user_changed_number"`
-- (ou `customer_identity_changed`) quando o usuário ativa o WhatsApp em
-- um número novo mantendo o mesmo BSUID. O contato preserva todo o
-- histórico (mesma row em `contacts`); este log registra a transição
-- pra (a) auditoria e (b) métricas agregadas.
CREATE TYPE "ContactPhoneChangeSource" AS ENUM ('WHATSAPP_SYSTEM', 'MANUAL', 'IMPORT');

CREATE TABLE IF NOT EXISTS "contact_phone_changes" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "old_phone" TEXT,
    "new_phone" TEXT,
    "old_bsuid" TEXT,
    "new_bsuid" TEXT,
    "source" "ContactPhoneChangeSource" NOT NULL DEFAULT 'WHATSAPP_SYSTEM',
    "raw_system_body" TEXT,
    "message_external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_phone_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "contact_phone_changes_contactId_idx"
    ON "contact_phone_changes" ("contactId");

CREATE INDEX IF NOT EXISTS "contact_phone_changes_created_at_idx"
    ON "contact_phone_changes" ("created_at");

CREATE INDEX IF NOT EXISTS "contact_phone_changes_source_idx"
    ON "contact_phone_changes" ("source");

CREATE INDEX IF NOT EXISTS "contact_phone_changes_source_created_at_idx"
    ON "contact_phone_changes" ("source", "created_at");

ALTER TABLE "contact_phone_changes"
    ADD CONSTRAINT "contact_phone_changes_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "contacts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
