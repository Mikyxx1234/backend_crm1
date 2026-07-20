ALTER TABLE "pipelines" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "pipelines_organizationId_archivedAt_idx" ON "pipelines"("organizationId", "archivedAt");
