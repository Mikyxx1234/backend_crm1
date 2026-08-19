-- Activity: criador separado do responsável + comentários assinados com histórico.

-- 1) createdById em activities (nullable) + backfill a partir do responsável
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "createdById" TEXT;

UPDATE "activities"
SET "createdById" = "userId"
WHERE "createdById" IS NULL AND "userId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "activities_organizationId_createdById_idx"
  ON "activities"("organizationId", "createdById");

DO $$ BEGIN
  ALTER TABLE "activities"
    ADD CONSTRAINT "activities_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2) Enum de ação de revisão
DO $$ BEGIN
  CREATE TYPE "ActivityCommentRevisionAction" AS ENUM ('CREATED', 'UPDATED', 'DELETED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3) Comentários de atividade
CREATE TABLE IF NOT EXISTS "activity_comments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "activity_comments_organizationId_idx"
  ON "activity_comments"("organizationId");
CREATE INDEX IF NOT EXISTS "activity_comments_organizationId_activityId_createdAt_idx"
  ON "activity_comments"("organizationId", "activityId", "createdAt");
CREATE INDEX IF NOT EXISTS "activity_comments_organizationId_authorId_idx"
  ON "activity_comments"("organizationId", "authorId");
CREATE INDEX IF NOT EXISTS "activity_comments_activityId_idx"
  ON "activity_comments"("activityId");

DO $$ BEGIN
  ALTER TABLE "activity_comments"
    ADD CONSTRAINT "activity_comments_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "activity_comments"
    ADD CONSTRAINT "activity_comments_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES "activities"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "activity_comments"
    ADD CONSTRAINT "activity_comments_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4) Revisões append-only
CREATE TABLE IF NOT EXISTS "activity_comment_revisions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "ActivityCommentRevisionAction" NOT NULL,
    "beforeContent" TEXT,
    "afterContent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_comment_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "activity_comment_revisions_organizationId_idx"
  ON "activity_comment_revisions"("organizationId");
CREATE INDEX IF NOT EXISTS "activity_comment_revisions_organizationId_commentId_createdAt_idx"
  ON "activity_comment_revisions"("organizationId", "commentId", "createdAt");
CREATE INDEX IF NOT EXISTS "activity_comment_revisions_commentId_createdAt_idx"
  ON "activity_comment_revisions"("commentId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "activity_comment_revisions"
    ADD CONSTRAINT "activity_comment_revisions_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "activity_comment_revisions"
    ADD CONSTRAINT "activity_comment_revisions_commentId_fkey"
    FOREIGN KEY ("commentId") REFERENCES "activity_comments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "activity_comment_revisions"
    ADD CONSTRAINT "activity_comment_revisions_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
