-- Add consent type (TEMPORARY/PERMANENT) + explicit expiresAt.
-- Meta docs: temporary = 7 days, permanent = until revoked.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WhatsappCallConsentType') THEN
    CREATE TYPE "WhatsappCallConsentType" AS ENUM ('TEMPORARY', 'PERMANENT');
  END IF;
END
$$;

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "whatsappCallConsentType" "WhatsappCallConsentType",
  ADD COLUMN IF NOT EXISTS "whatsappCallConsentExpiresAt" TIMESTAMP(3);

-- Backfill: registros já GRANTED sem tipo → assume TEMPORARY com expiresAt = updatedAt + 7 dias.
-- Se essa janela já passou, o status efetivo vira EXPIRED (computado no cliente).
UPDATE "conversations"
SET
  "whatsappCallConsentType" = 'TEMPORARY',
  "whatsappCallConsentExpiresAt" = "whatsappCallConsentUpdatedAt" + INTERVAL '7 days'
WHERE
  "whatsappCallConsentStatus" = 'GRANTED'
  AND "whatsappCallConsentType" IS NULL
  AND "whatsappCallConsentUpdatedAt" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "conversations_whatsappCallConsentExpiresAt_idx"
  ON "conversations" ("whatsappCallConsentExpiresAt");
