-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "external_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "contacts_external_id_key" ON "contacts"("external_id");

-- AlterTable
ALTER TABLE "deals" ADD COLUMN "external_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "deals_external_id_key" ON "deals"("external_id");
