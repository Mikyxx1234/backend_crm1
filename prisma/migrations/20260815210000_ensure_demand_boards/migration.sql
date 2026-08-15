-- Demandas: boards internos (Roadmap / Bugs / Suporte) estilo Pipefy.
-- Idempotente: IF NOT EXISTS / duplicate_object.

CREATE TABLE IF NOT EXISTS "demand_boards" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CUSTOM',
    "description" TEXT,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demand_boards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "demand_stages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demand_stages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "demand_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'REQUEST',
    "priority" TEXT NOT NULL DEFAULT 'NONE',
    "position" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "votesCount" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "requesterId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demand_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "demand_comments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demand_comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "demand_votes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demand_votes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "demand_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demand_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "demand_boards_organizationId_slug_key"
  ON "demand_boards"("organizationId", "slug");
CREATE INDEX IF NOT EXISTS "demand_boards_organizationId_archivedAt_idx"
  ON "demand_boards"("organizationId", "archivedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "demand_stages_boardId_key_key"
  ON "demand_stages"("boardId", "key");
CREATE INDEX IF NOT EXISTS "demand_stages_organizationId_boardId_idx"
  ON "demand_stages"("organizationId", "boardId");

CREATE UNIQUE INDEX IF NOT EXISTS "demand_items_organizationId_number_key"
  ON "demand_items"("organizationId", "number");
CREATE INDEX IF NOT EXISTS "demand_items_organizationId_boardId_stageId_idx"
  ON "demand_items"("organizationId", "boardId", "stageId");
CREATE INDEX IF NOT EXISTS "demand_items_organizationId_assigneeId_idx"
  ON "demand_items"("organizationId", "assigneeId");
CREATE INDEX IF NOT EXISTS "demand_items_boardId_stageId_position_idx"
  ON "demand_items"("boardId", "stageId", "position");

CREATE INDEX IF NOT EXISTS "demand_comments_itemId_createdAt_idx"
  ON "demand_comments"("itemId", "createdAt");
CREATE INDEX IF NOT EXISTS "demand_comments_organizationId_idx"
  ON "demand_comments"("organizationId");

CREATE UNIQUE INDEX IF NOT EXISTS "demand_votes_itemId_userId_key"
  ON "demand_votes"("itemId", "userId");
CREATE INDEX IF NOT EXISTS "demand_votes_organizationId_idx"
  ON "demand_votes"("organizationId");

CREATE INDEX IF NOT EXISTS "demand_events_itemId_createdAt_idx"
  ON "demand_events"("itemId", "createdAt");
CREATE INDEX IF NOT EXISTS "demand_events_organizationId_idx"
  ON "demand_events"("organizationId");

DO $$ BEGIN
  ALTER TABLE "demand_boards"
    ADD CONSTRAINT "demand_boards_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "demand_stages"
    ADD CONSTRAINT "demand_stages_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "demand_stages"
    ADD CONSTRAINT "demand_stages_boardId_fkey"
    FOREIGN KEY ("boardId") REFERENCES "demand_boards"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "demand_items"
    ADD CONSTRAINT "demand_items_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "demand_items"
    ADD CONSTRAINT "demand_items_boardId_fkey"
    FOREIGN KEY ("boardId") REFERENCES "demand_boards"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "demand_items"
    ADD CONSTRAINT "demand_items_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "demand_stages"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "demand_items"
    ADD CONSTRAINT "demand_items_requesterId_fkey"
    FOREIGN KEY ("requesterId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "demand_items"
    ADD CONSTRAINT "demand_items_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "demand_comments"
    ADD CONSTRAINT "demand_comments_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "demand_comments"
    ADD CONSTRAINT "demand_comments_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "demand_items"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "demand_comments"
    ADD CONSTRAINT "demand_comments_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "demand_votes"
    ADD CONSTRAINT "demand_votes_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "demand_votes"
    ADD CONSTRAINT "demand_votes_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "demand_items"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "demand_votes"
    ADD CONSTRAINT "demand_votes_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "demand_events"
    ADD CONSTRAINT "demand_events_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "demand_events"
    ADD CONSTRAINT "demand_events_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "demand_items"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "demand_events"
    ADD CONSTRAINT "demand_events_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Presets MANAGER/MEMBER: boards de demandas. ADMIN já tem `*`.
UPDATE "roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT k FROM UNNEST(
    "permissions" || ARRAY[
      'nav:demands',
      'demand:view',
      'demand:create',
      'demand:edit',
      'demand:move',
      'demand:comment',
      'demand:vote',
      'demand:manage_board'
    ]::TEXT[]
  ) AS k
),
"updatedAt" = NOW()
WHERE "systemPreset" = 'MANAGER';

UPDATE "roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT k FROM UNNEST(
    "permissions" || ARRAY[
      'nav:demands',
      'demand:view',
      'demand:create',
      'demand:edit',
      'demand:move',
      'demand:comment',
      'demand:vote'
    ]::TEXT[]
  ) AS k
),
"updatedAt" = NOW()
WHERE "systemPreset" = 'MEMBER';

