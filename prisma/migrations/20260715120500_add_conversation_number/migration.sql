-- 15/jul/26 — ID amigavel de conversa (sequencial por organizacao).
-- Padrao ja usado por Contact.number e Deal.number.
-- Aditiva e idempotente: pode rodar mais de uma vez sem erro.

-- 1) Adiciona a coluna nullable pra permitir backfill sem violar NOT NULL.
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "number" INTEGER;

-- 2) Backfill: numera as conversas existentes por org, ordenadas por
--    createdAt (empate desempatado pelo id — determinismo em corrida).
--    ROW_NUMBER() garante sequencial denso comecando em 1 por org.
--    WHERE "number" IS NULL torna a migration idempotente: se ja rodou,
--    nao renumera.
WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", id) AS rn
  FROM "conversations"
  WHERE "number" IS NULL
)
UPDATE "conversations" c
SET "number" = n.rn
FROM numbered n
WHERE c.id = n.id;

-- 3) Torna NOT NULL depois do backfill.
ALTER TABLE "conversations" ALTER COLUMN "number" SET NOT NULL;

-- 4) Unique index por (organizationId, number) — mesmo padrao de
--    contacts_organizationId_number_key e deals_organizationId_number_key.
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_organizationId_number_key"
  ON "conversations"("organizationId", "number");
