-- CreateTable (IF NOT EXISTS to be safe if already created via db push)
CREATE TABLE IF NOT EXISTS "automations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "triggerType" TEXT NOT NULL,
    "triggerConfig" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "automation_steps" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "automationId" TEXT NOT NULL,

    CONSTRAINT "automation_steps_pkey" PRIMARY KEY ("id")
);

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

-- Enum for automation context status
DO $$ BEGIN
    CREATE TYPE "AutomationCtxStatus" AS ENUM ('RUNNING', 'PAUSED', 'COMPLETED', 'TIMED_OUT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "automation_contexts" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "currentStepId" TEXT,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "status" "AutomationCtxStatus" NOT NULL DEFAULT 'RUNNING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_contexts_pkey" PRIMARY KEY ("id")
);

-- Indexes (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "automations_active_idx" ON "automations"("active");
CREATE INDEX IF NOT EXISTS "automations_active_triggerType_idx" ON "automations"("active", "triggerType");

CREATE INDEX IF NOT EXISTS "automation_steps_automationId_idx" ON "automation_steps"("automationId");
CREATE INDEX IF NOT EXISTS "automation_steps_automationId_position_idx" ON "automation_steps"("automationId", "position");

CREATE INDEX IF NOT EXISTS "automation_logs_automationId_idx" ON "automation_logs"("automationId");
CREATE INDEX IF NOT EXISTS "automation_logs_contactId_idx" ON "automation_logs"("contactId");
CREATE INDEX IF NOT EXISTS "automation_logs_dealId_idx" ON "automation_logs"("dealId");
CREATE INDEX IF NOT EXISTS "automation_logs_executedAt_idx" ON "automation_logs"("executedAt");
CREATE INDEX IF NOT EXISTS "automation_logs_automationId_executedAt_idx" ON "automation_logs"("automationId", "executedAt");

CREATE INDEX IF NOT EXISTS "automation_contexts_automationId_contactId_idx" ON "automation_contexts"("automationId", "contactId");
CREATE INDEX IF NOT EXISTS "automation_contexts_contactId_status_idx" ON "automation_contexts"("contactId", "status");

-- Foreign keys (safe with DO blocks)
DO $$ BEGIN
    ALTER TABLE "automation_steps" ADD CONSTRAINT "automation_steps_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "automation_contexts" ADD CONSTRAINT "automation_contexts_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "automation_contexts" ADD CONSTRAINT "automation_contexts_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
