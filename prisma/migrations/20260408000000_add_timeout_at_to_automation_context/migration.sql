-- AlterTable
ALTER TABLE "automation_contexts" ADD COLUMN "timeoutAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "automation_contexts_status_timeoutAt_idx" ON "automation_contexts"("status", "timeoutAt");
