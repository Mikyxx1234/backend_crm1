-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "cep" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "state" TEXT;

-- CreateIndex
CREATE INDEX "companies_organizationId_state_idx" ON "companies"("organizationId", "state");

-- CreateIndex
CREATE INDEX "companies_organizationId_city_idx" ON "companies"("organizationId", "city");
