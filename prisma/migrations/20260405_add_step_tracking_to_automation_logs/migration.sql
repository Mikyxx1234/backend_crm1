-- Ensure the automation_logs table exists before altering
CREATE TABLE IF NOT EXISTS "automation_logs" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "contactId" TEXT,
    "dealId" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "automation_logs_pkey" PRIMARY KEY ("id")
);

-- Add step-level tracking columns
ALTER TABLE "automation_logs" ADD COLUMN IF NOT EXISTS "stepId" TEXT;
ALTER TABLE "automation_logs" ADD COLUMN IF NOT EXISTS "stepType" TEXT;

-- Indexes (idempotent)
CREATE INDEX IF NOT EXISTS "automation_logs_automationId_idx" ON "automation_logs"("automationId");
CREATE INDEX IF NOT EXISTS "automation_logs_automationId_stepId_idx" ON "automation_logs"("automationId", "stepId");
