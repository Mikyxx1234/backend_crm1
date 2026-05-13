-- AlterTable: add closedAt to deals (if not exists)
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);

-- AlterTable: add closedAt to conversations (if not exists)
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);
