-- 14/ago/26 — ID amigável de tabulação (sequencial por organização).
-- Padrão já usado por Contact.number, Deal.number e Conversation.number.
-- Aditiva e idempotente: pode rodar mais de uma vez sem erro.

-- 1) Coluna nullable pra permitir backfill sem violar NOT NULL.
ALTER TABLE "tabulations" ADD COLUMN IF NOT EXISTS "number" INTEGER;

-- 2) Backfill: numera as tabulações existentes por org, ordenadas por
--    createdAt (empate pelo id). WHERE "number" IS NULL torna a
--    migration idempotente: se já rodou, não renumera.
WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", id) AS rn
  FROM "tabulations"
  WHERE "number" IS NULL
)
UPDATE "tabulations" t
SET "number" = n.rn
FROM numbered n
WHERE t.id = n.id;

-- 3) NOT NULL depois do backfill.
ALTER TABLE "tabulations" ALTER COLUMN "number" SET NOT NULL;

-- 4) Unique (organizationId, number) — mesmo padrão de
--    contacts_organizationId_number_key / deals_organizationId_number_key.
CREATE UNIQUE INDEX IF NOT EXISTS "tabulations_organizationId_number_key"
  ON "tabulations"("organizationId", "number");

-- 5) Snapshot do nome + number nos eventos CONVERSATION_TABULATED
--    já gravados, pra a timeline deixar de mostrar o CUID truncado.
--    Só preenche quando tabulationName ainda não existe.
UPDATE "activity_events" e
SET meta = e.meta || jsonb_build_object(
  'tabulationName', t.name,
  'tabulationNumber', t.number
)
FROM "tabulations" t
WHERE e."type" = 'CONVERSATION_TABULATED'
  AND e.meta->>'tabulationId' = t.id
  AND (e.meta->>'tabulationName' IS NULL OR e.meta->>'tabulationName' = '');
