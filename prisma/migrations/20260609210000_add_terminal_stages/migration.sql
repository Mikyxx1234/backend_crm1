-- Estágios terminais fixos (estilo Kommo): cada pipeline passa a ter
-- "Ganho" (isWon) e "Perdido" (isLost) como os dois últimos estágios.
-- Backfill idempotente:
--   1. Novas colunas em stages.
--   2. Cria os 2 estágios terminais em todo pipeline que ainda não tem.
--   3. Move deals já fechados (status WON/LOST) para o estágio terminal
--      correspondente do seu pipeline, garantindo closedAt preenchido.

ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "isWon" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "isLost" BOOLEAN NOT NULL DEFAULT false;

-- 2a. Estágio "Ganho" (posição = max + 1)
INSERT INTO "stages" ("id", "organizationId", "name", "position", "color", "winProbability", "rottingDays", "isIncoming", "isWon", "isLost", "pipelineId")
SELECT
  'c' || replace(gen_random_uuid()::text, '-', ''),
  p."organizationId",
  'Ganho',
  COALESCE((SELECT MAX(s."position") FROM "stages" s WHERE s."pipelineId" = p."id"), -1) + 1,
  '#16a34a',
  100,
  3650,
  false,
  true,
  false,
  p."id"
FROM "pipelines" p
WHERE NOT EXISTS (
  SELECT 1 FROM "stages" s WHERE s."pipelineId" = p."id" AND s."isWon" = true
);

-- 2b. Estágio "Perdido" (posição = max + 1, já contando o "Ganho" recém-criado)
INSERT INTO "stages" ("id", "organizationId", "name", "position", "color", "winProbability", "rottingDays", "isIncoming", "isWon", "isLost", "pipelineId")
SELECT
  'c' || replace(gen_random_uuid()::text, '-', ''),
  p."organizationId",
  'Perdido',
  COALESCE((SELECT MAX(s."position") FROM "stages" s WHERE s."pipelineId" = p."id"), -1) + 1,
  '#ef4444',
  0,
  3650,
  false,
  false,
  true,
  p."id"
FROM "pipelines" p
WHERE NOT EXISTS (
  SELECT 1 FROM "stages" s WHERE s."pipelineId" = p."id" AND s."isLost" = true
);

-- 3a. Deals WON fora do estágio Ganho → movem para o Ganho do pipeline.
UPDATE "deals" d
SET "stageId" = won."id",
    "closedAt" = COALESCE(d."closedAt", NOW())
FROM "stages" cur
JOIN "stages" won ON won."pipelineId" = cur."pipelineId" AND won."isWon" = true
WHERE d."stageId" = cur."id"
  AND d."status" = 'WON'
  AND cur."isWon" = false;

-- 3b. Deals LOST fora do estágio Perdido → movem para o Perdido do pipeline.
UPDATE "deals" d
SET "stageId" = lost."id",
    "closedAt" = COALESCE(d."closedAt", NOW())
FROM "stages" cur
JOIN "stages" lost ON lost."pipelineId" = cur."pipelineId" AND lost."isLost" = true
WHERE d."stageId" = cur."id"
  AND d."status" = 'LOST'
  AND cur."isLost" = false;
