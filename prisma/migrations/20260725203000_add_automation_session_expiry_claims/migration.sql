CREATE TABLE "automation_session_expiry_claims" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "conversationId" TEXT,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "sessionExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_session_expiry_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_session_expiry_claim_window_uq"
ON "automation_session_expiry_claims"("automationId", "contactId", "channel", "windowStartedAt");

CREATE INDEX "automation_session_expiry_org_created_idx"
ON "automation_session_expiry_claims"("organizationId", "createdAt");

CREATE INDEX "automation_session_expiry_contact_channel_window_idx"
ON "automation_session_expiry_claims"("contactId", "channel", "windowStartedAt");

ALTER TABLE "automation_session_expiry_claims"
ADD CONSTRAINT "automation_session_expiry_org_fk"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_session_expiry_claims"
ADD CONSTRAINT "automation_session_expiry_automation_fk"
FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_session_expiry_claims"
ADD CONSTRAINT "automation_session_expiry_contact_fk"
FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_session_expiry_claims"
ADD CONSTRAINT "automation_session_expiry_conversation_fk"
FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
