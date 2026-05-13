-- AlterTable
ALTER TABLE "agent_statuses" ADD COLUMN "availableForVoiceCalls" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "ScheduledWhatsappCallStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "scheduled_whatsapp_calls" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "assigneeUserId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledWhatsappCallStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "sourceMetaCallId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_whatsapp_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_whatsapp_calls_conversationId_scheduledAt_idx" ON "scheduled_whatsapp_calls"("conversationId", "scheduledAt");

-- CreateIndex
CREATE INDEX "scheduled_whatsapp_calls_assigneeUserId_scheduledAt_status_idx" ON "scheduled_whatsapp_calls"("assigneeUserId", "scheduledAt", "status");

-- CreateIndex
CREATE INDEX "scheduled_whatsapp_calls_status_scheduledAt_idx" ON "scheduled_whatsapp_calls"("status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "scheduled_whatsapp_calls" ADD CONSTRAINT "scheduled_whatsapp_calls_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scheduled_whatsapp_calls" ADD CONSTRAINT "scheduled_whatsapp_calls_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scheduled_whatsapp_calls" ADD CONSTRAINT "scheduled_whatsapp_calls_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
