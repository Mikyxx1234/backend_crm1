-- Chat interno do time (DMs + grupos). Idempotente.

CREATE TABLE IF NOT EXISTS "team_chat_rooms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "topic" TEXT,
    "dmKey" TEXT,
    "createdById" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPreview" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_chat_rooms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "team_chat_members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_chat_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "team_chat_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "authorId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "team_chat_rooms_organizationId_dmKey_key"
  ON "team_chat_rooms"("organizationId", "dmKey");

CREATE INDEX IF NOT EXISTS "team_chat_rooms_organizationId_lastMessageAt_idx"
  ON "team_chat_rooms"("organizationId", "lastMessageAt");

CREATE UNIQUE INDEX IF NOT EXISTS "team_chat_members_roomId_userId_key"
  ON "team_chat_members"("roomId", "userId");

CREATE INDEX IF NOT EXISTS "team_chat_members_organizationId_userId_idx"
  ON "team_chat_members"("organizationId", "userId");

CREATE INDEX IF NOT EXISTS "team_chat_messages_roomId_createdAt_idx"
  ON "team_chat_messages"("roomId", "createdAt");

CREATE INDEX IF NOT EXISTS "team_chat_messages_organizationId_idx"
  ON "team_chat_messages"("organizationId");

DO $$ BEGIN
  ALTER TABLE "team_chat_rooms"
    ADD CONSTRAINT "team_chat_rooms_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "team_chat_rooms"
    ADD CONSTRAINT "team_chat_rooms_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "team_chat_members"
    ADD CONSTRAINT "team_chat_members_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "team_chat_members"
    ADD CONSTRAINT "team_chat_members_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "team_chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "team_chat_members"
    ADD CONSTRAINT "team_chat_members_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "team_chat_messages"
    ADD CONSTRAINT "team_chat_messages_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "team_chat_messages"
    ADD CONSTRAINT "team_chat_messages_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "team_chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "team_chat_messages"
    ADD CONSTRAINT "team_chat_messages_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Presets MANAGER/MEMBER: chat interno. ADMIN já tem `*`.
UPDATE "roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT k FROM UNNEST(
    "permissions" || ARRAY[
      'nav:team-chat',
      'team_chat:view',
      'team_chat:send',
      'team_chat:create_room'
    ]::TEXT[]
  ) AS k
),
"updatedAt" = NOW()
WHERE "systemPreset" IN ('MANAGER', 'MEMBER');
