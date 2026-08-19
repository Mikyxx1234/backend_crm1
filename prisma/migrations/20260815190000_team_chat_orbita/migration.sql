ALTER TABLE "team_chat_messages" ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "team_chat_messages" ADD COLUMN IF NOT EXISTS "reactions" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS "team_chat_notes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_chat_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "team_chat_notes_roomId_authorId_idx" ON "team_chat_notes"("roomId", "authorId");
CREATE INDEX IF NOT EXISTS "team_chat_notes_organizationId_idx" ON "team_chat_notes"("organizationId");

DO $$ BEGIN
  ALTER TABLE "team_chat_notes"
    ADD CONSTRAINT "team_chat_notes_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "team_chat_notes"
    ADD CONSTRAINT "team_chat_notes_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "team_chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "team_chat_notes"
    ADD CONSTRAINT "team_chat_notes_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
