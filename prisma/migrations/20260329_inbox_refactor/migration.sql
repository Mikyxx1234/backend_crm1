-- Conversation: track message direction, agent reply, and error state
ALTER TABLE "conversations" ADD COLUMN "lastMessageDirection" TEXT;
ALTER TABLE "conversations" ADD COLUMN "hasAgentReply" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "conversations" ADD COLUMN "hasError" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "conversations_hasError_idx" ON "conversations"("hasError");
CREATE INDEX "conversations_lastMessageDirection_hasAgentReply_idx" ON "conversations"("lastMessageDirection", "hasAgentReply");

-- Message: track send status and error
ALTER TABLE "messages" ADD COLUMN "sendStatus" TEXT NOT NULL DEFAULT 'sent';
ALTER TABLE "messages" ADD COLUMN "sendError" TEXT;

-- Backfill lastMessageDirection from latest message per conversation
UPDATE "conversations" c
SET "lastMessageDirection" = sub.direction
FROM (
  SELECT DISTINCT ON ("conversationId") "conversationId", "direction"
  FROM "messages"
  ORDER BY "conversationId", "createdAt" DESC
) sub
WHERE c.id = sub."conversationId";

-- Backfill hasAgentReply: true if any outbound non-private message exists
UPDATE "conversations" c
SET "hasAgentReply" = true
WHERE EXISTS (
  SELECT 1 FROM "messages" m
  WHERE m."conversationId" = c.id
    AND m.direction = 'out'
    AND m."isPrivate" = false
);
