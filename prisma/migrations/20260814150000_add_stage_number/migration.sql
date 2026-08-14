-- 14/ago/26 — ID amigável de estágio (sequencial por pipeline).
-- Mesmo padrão de Pipeline.number / Deal.number / Contact.number.
-- Aditiva e idempotente: pode rodar mais de uma vez sem erro.
-- `position` NÃO serve de URL id: muda no reorder e pode ter gaps.

-- 1) Coluna nullable pra permitir backfill sem violar NOT NULL.
ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "number" INTEGER;

-- 2) Backfill: numera os estágios existentes por funil, na ordem visual
--    atual (position; empate pelo id). WHERE "number" IS NULL torna a
--    migration idempotente: se já rodou, não renumera.
WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY "pipelineId" ORDER BY "position", id) AS rn
  FROM "stages"
  WHERE "number" IS NULL
)
UPDATE "stages" s
SET "number" = n.rn
FROM numbered n
WHERE s.id = n.id;

-- 3) NOT NULL depois do backfill.
ALTER TABLE "stages" ALTER COLUMN "number" SET NOT NULL;

-- 4) Unique (pipelineId, number) — estável mesmo após reorder.
CREATE UNIQUE INDEX IF NOT EXISTS "stages_pipelineId_number_key"
  ON "stages"("pipelineId", "number");
