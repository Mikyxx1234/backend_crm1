-- CreateTable
CREATE TABLE "meta_webhook_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "channelId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signatureValid" BOOLEAN NOT NULL,
    "objectType" TEXT,
    "eventType" TEXT NOT NULL,
    "phoneNumberId" TEXT,
    "waMessageId" TEXT,
    "fromPhone" TEXT,
    "rawBody" JSONB NOT NULL,
    "headers" JSONB,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processingError" TEXT,

    CONSTRAINT "meta_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meta_webhook_events_organizationId_receivedAt_idx" ON "meta_webhook_events"("organizationId", "receivedAt" DESC);

-- CreateIndex
CREATE INDEX "meta_webhook_events_waMessageId_idx" ON "meta_webhook_events"("waMessageId");

-- CreateIndex
CREATE INDEX "meta_webhook_events_phoneNumberId_receivedAt_idx" ON "meta_webhook_events"("phoneNumberId", "receivedAt" DESC);

-- AddForeignKey
ALTER TABLE "meta_webhook_events" ADD CONSTRAINT "meta_webhook_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_webhook_events" ADD CONSTRAINT "meta_webhook_events_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "automation_logs" ADD COLUMN "metaWebhookEventId" TEXT;

-- CreateIndex
CREATE INDEX "automation_logs_metaWebhookEventId_idx" ON "automation_logs"("metaWebhookEventId");

-- AddForeignKey
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_metaWebhookEventId_fkey" FOREIGN KEY ("metaWebhookEventId") REFERENCES "meta_webhook_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
