-- 14/ago/26 — ID amigável de pipeline (sequencial por organização).
-- Padrão já usado por Contact.number, Deal.number e Tabulation.number.
-- Aditiva e idempotente: pode rodar mais de uma vez sem erro.

-- 1) Coluna nullable pra permitir backfill sem violar NOT NULL.
ALTER TABLE "pipelines" ADD COLUMN IF NOT EXISTS "number" INTEGER;

-- 2) Backfill: numera os pipelines existentes por org, ordenados por
--    createdAt (empate pelo id). WHERE "number" IS NULL torna a
--    migration idempotente: se já rodou, não renumera.
WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", id) AS rn
  FROM "pipelines"
  WHERE "number" IS NULL
)
UPDATE "pipelines" p
SET "number" = n.rn
FROM numbered n
WHERE p.id = n.id;

-- 3) NOT NULL depois do backfill.
ALTER TABLE "pipelines" ALTER COLUMN "number" SET NOT NULL;

-- 4) Unique (organizationId, number) — mesmo padrão de
--    deals_organizationId_number_key / tabulations_organizationId_number_key.
CREATE UNIQUE INDEX IF NOT EXISTS "pipelines_organizationId_number_key"
  ON "pipelines"("organizationId", "number");
