-- AlterTable (idempotent: coluna já existe no init 20240101000000)
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "lastInboundAt" TIMESTAMP(3);

-- Backfill from existing messages
UPDATE "conversations" c
SET "lastInboundAt" = sub."lastIn"
FROM (
  SELECT "conversationId", MAX("createdAt") AS "lastIn"
  FROM "messages"
  WHERE "direction" = 'in'
  GROUP BY "conversationId"
) sub
WHERE c.id = sub."conversationId"
  AND c."lastInboundAt" IS NULL;
