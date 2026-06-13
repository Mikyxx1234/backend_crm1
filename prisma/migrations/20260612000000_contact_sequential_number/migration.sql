-- Migration: contact_sequential_number
-- Adiciona campo `number` sequencial por organização ao model Contact.
-- Escrita de forma IDEMPOTENTE (ADD COLUMN IF NOT EXISTS, guards DO $$).
--
-- ATENÇÃO: colunas do modelo Contact usam camelCase no banco PostgreSQL
-- (ex: "organizationId", "createdAt") sem @map individual — apenas @@map("contacts").

-- Passo 1: adicionar coluna nullable (idempotente)
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "number" INTEGER;

-- Passo 2: backfill com numeração sequencial por organização
-- (WHERE "number" IS NULL garante idempotência em re-execuções)
UPDATE "contacts"
SET "number" = sub."rn"
FROM (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "organizationId"
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "contacts"
  WHERE "number" IS NULL
) AS sub
WHERE "contacts".id = sub.id;

-- Passo 3: tornar NOT NULL
ALTER TABLE "contacts" ALTER COLUMN "number" SET NOT NULL;

-- Passo 4: constraint UNIQUE (idempotente via DO $$)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_organization_id_number_key'
  ) THEN
    ALTER TABLE "contacts"
      ADD CONSTRAINT "contacts_organization_id_number_key"
      UNIQUE ("organizationId", "number");
  END IF;
END $$;

-- Passo 5: índice composto (idempotente via IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "contacts_organization_id_number_idx"
  ON "contacts" ("organizationId", "number");
