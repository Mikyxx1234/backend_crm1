-- CreateEnum
CREATE TYPE "WhatsappCallConsentStatus" AS ENUM ('NONE', 'REQUESTED', 'GRANTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "whatsappCallConsentStatus" "WhatsappCallConsentStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN "whatsappCallConsentUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "conversations_whatsappCallConsentStatus_idx" ON "conversations"("whatsappCallConsentStatus");
