-- Snapshot do departamento no log de distribuicao (independente da conversa).
ALTER TABLE "distribution_logs"
  ADD COLUMN IF NOT EXISTS "departmentId" TEXT;

CREATE INDEX IF NOT EXISTS "distribution_logs_organizationId_departmentId_idx"
  ON "distribution_logs"("organizationId", "departmentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'distribution_logs_departmentId_fkey'
  ) THEN
    ALTER TABLE "distribution_logs"
      ADD CONSTRAINT "distribution_logs_departmentId_fkey"
      FOREIGN KEY ("departmentId") REFERENCES "departments"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: conversa ainda com departamento.
UPDATE "distribution_logs" AS dl
SET "departmentId" = c."departmentId"
FROM "conversations" AS c
WHERE dl."conversationId" = c."id"
  AND dl."departmentId" IS NULL
  AND c."departmentId" IS NOT NULL;

-- Backfill: nota interna do handoff ("Conversa distribuída para Retenção").
UPDATE "distribution_logs" AS dl
SET "departmentId" = d.id
FROM "messages" AS m
JOIN "departments" AS d
  ON d."organizationId" = m."organizationId"
 AND lower(m.content) LIKE lower('Conversa distribuída para ' || d.name || '%')
WHERE dl."conversationId" = m."conversationId"
  AND dl."departmentId" IS NULL
  AND m."messageType" = 'note'
  AND m."isPrivate" = true
  AND m.content LIKE 'Conversa distribuída para %'
  AND m.content NOT LIKE 'Conversa distribuída para a fila%';
