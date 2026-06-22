-- CreateEnum: TelephonyProvisioningStep
CREATE TYPE "TelephonyProvisioningStep" AS ENUM (
  'IDLE',
  'CHECK_REMOTE',
  'CREATE_USER',
  'CREATE_EXTENSION',
  'CONFIG_WEBHOOK',
  'ACTIVE',
  'FAILED',
  'DISABLED'
);

-- AlterTable: sip_extensions (provisionamento Api4com)
ALTER TABLE "sip_extensions" ADD COLUMN "telephony_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sip_extensions" ADD COLUMN "api4com_user_id" TEXT;
ALTER TABLE "sip_extensions" ADD COLUMN "api4com_gateway" TEXT;
ALTER TABLE "sip_extensions" ADD COLUMN "provisioning_step" "TelephonyProvisioningStep" NOT NULL DEFAULT 'IDLE';
ALTER TABLE "sip_extensions" ADD COLUMN "provisioning_error" TEXT;
ALTER TABLE "sip_extensions" ADD COLUMN "provisioned_at" TIMESTAMP(3);

-- AlterTable: calls (deal + metadata)
ALTER TABLE "calls" ADD COLUMN "deal_id" TEXT;
ALTER TABLE "calls" ADD COLUMN "metadata" JSONB;

-- CreateIndex: calls.deal_id
CREATE INDEX "calls_organizationId_deal_id_idx" ON "calls"("organizationId", "deal_id");

-- AddForeignKey: calls → deals
ALTER TABLE "calls" ADD CONSTRAINT "calls_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
