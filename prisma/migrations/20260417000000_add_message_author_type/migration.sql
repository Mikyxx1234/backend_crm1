-- Distinguishes human agents from bot/automation responses and system events.
-- Default "human" keeps existing code paths working until services are updated
-- to set the value explicitly. A best-effort backfill reclassifies past rows
-- based on the conventions currently in use.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MessageAuthorType') THEN
    CREATE TYPE "MessageAuthorType" AS ENUM ('human', 'bot', 'system');
  END IF;
END $$;

ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "authorType" "MessageAuthorType" NOT NULL DEFAULT 'human';

-- Backfill: automation executor persists senderName = 'Automação'.
UPDATE "messages"
   SET "authorType" = 'bot'
 WHERE "senderName" = 'Automação'
   AND "authorType" = 'human';

-- Backfill: system-direction messages (Meta lifecycle, integration events).
UPDATE "messages"
   SET "authorType" = 'system'
 WHERE "direction" = 'system'
   AND "authorType" = 'human';

CREATE INDEX IF NOT EXISTS "messages_conversationId_authorType_createdAt_idx"
  ON "messages" ("conversationId", "authorType", "createdAt");

-- Safety net: trigger auto-classifies rows where the caller forgot to set
-- authorType. Keeps legacy/unmigrated services (automation-executor, webhooks,
-- seeds) consistent with the dashboard without touching every create site.
CREATE OR REPLACE FUNCTION message_author_type_default()
RETURNS trigger AS $$
BEGIN
  IF NEW."authorType" = 'human' THEN
    IF NEW."senderName" = 'Automação' THEN
      NEW."authorType" := 'bot';
    ELSIF NEW."direction" = 'system' THEN
      NEW."authorType" := 'system';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_message_author_type_default ON "messages";
CREATE TRIGGER trg_message_author_type_default
BEFORE INSERT ON "messages"
FOR EACH ROW
EXECUTE FUNCTION message_author_type_default();
