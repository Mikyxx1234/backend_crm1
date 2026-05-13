-- CreateTable
CREATE TABLE "whatsapp_call_events" (
    "id" TEXT NOT NULL,
    "metaCallId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "eventKind" TEXT NOT NULL,
    "signalingStatus" TEXT,
    "terminateStatus" TEXT,
    "fromWa" TEXT,
    "toWa" TEXT,
    "durationSec" INTEGER,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "bizOpaque" TEXT,
    "errorsJson" JSONB,
    "conversationId" TEXT,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_call_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_call_events_metaCallId_idx" ON "whatsapp_call_events"("metaCallId");

-- CreateIndex
CREATE INDEX "whatsapp_call_events_conversationId_createdAt_idx" ON "whatsapp_call_events"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "whatsapp_call_events_contactId_createdAt_idx" ON "whatsapp_call_events"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "whatsapp_call_events_createdAt_idx" ON "whatsapp_call_events"("createdAt");

-- AddForeignKey
ALTER TABLE "whatsapp_call_events" ADD CONSTRAINT "whatsapp_call_events_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_call_events" ADD CONSTRAINT "whatsapp_call_events_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
