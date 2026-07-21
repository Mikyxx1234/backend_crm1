-- Permite motivo personalizado por funil (antes: org setting deals.loss_reason_allow_other).

ALTER TABLE "pipelines"
  ADD COLUMN IF NOT EXISTS "lossReasonAllowOther" BOOLEAN NOT NULL DEFAULT true;

-- Backfill a partir da setting org-wide (default permissivo = true).
UPDATE "pipelines" p
SET "lossReasonAllowOther" = false
WHERE EXISTS (
  SELECT 1
  FROM "organization_settings" os
  WHERE os."organizationId" = p."organizationId"
    AND os."key" = 'deals.loss_reason_allow_other'
    AND os."value" = 'false'
);
