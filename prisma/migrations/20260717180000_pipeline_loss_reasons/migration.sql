-- Motivos de perda por funil (M2M) + obrigatoriedade por pipeline.

ALTER TABLE "pipelines"
  ADD COLUMN IF NOT EXISTS "lossReasonRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "pipeline_loss_reasons" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "pipelineId"     TEXT NOT NULL,
  "lossReasonId"   TEXT NOT NULL,
  "position"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pipeline_loss_reasons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_loss_reasons_pipelineId_lossReasonId_key"
  ON "pipeline_loss_reasons"("pipelineId", "lossReasonId");

CREATE INDEX IF NOT EXISTS "pipeline_loss_reasons_organizationId_idx"
  ON "pipeline_loss_reasons"("organizationId");

CREATE INDEX IF NOT EXISTS "pipeline_loss_reasons_pipelineId_position_idx"
  ON "pipeline_loss_reasons"("pipelineId", "position");

CREATE INDEX IF NOT EXISTS "pipeline_loss_reasons_lossReasonId_idx"
  ON "pipeline_loss_reasons"("lossReasonId");

ALTER TABLE "pipeline_loss_reasons"
  ADD CONSTRAINT "pipeline_loss_reasons_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pipeline_loss_reasons"
  ADD CONSTRAINT "pipeline_loss_reasons_pipelineId_fkey"
  FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pipeline_loss_reasons"
  ADD CONSTRAINT "pipeline_loss_reasons_lossReasonId_fkey"
  FOREIGN KEY ("lossReasonId") REFERENCES "loss_reasons"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: vincula motivos ativos a todos os funis da mesma org
-- (preserva UX atual até o admin reorganizar por funil).
INSERT INTO "pipeline_loss_reasons" ("id", "organizationId", "pipelineId", "lossReasonId", "position", "createdAt")
SELECT
  md5(random()::text || clock_timestamp()::text || p.id || lr.id),
  p."organizationId",
  p.id,
  lr.id,
  lr."position",
  CURRENT_TIMESTAMP
FROM "pipelines" p
INNER JOIN "loss_reasons" lr
  ON lr."organizationId" = p."organizationId"
 AND lr."isActive" = true
ON CONFLICT ("pipelineId", "lossReasonId") DO NOTHING;

-- Copia a setting org-wide de obrigatoriedade para cada funil.
UPDATE "pipelines" p
SET "lossReasonRequired" = true
WHERE EXISTS (
  SELECT 1
  FROM "organization_settings" os
  WHERE os."organizationId" = p."organizationId"
    AND os."key" = 'deals.loss_reason_required'
    AND os."value" = 'true'
);
