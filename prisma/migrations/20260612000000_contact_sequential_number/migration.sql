-- Migration: contact_sequential_number
-- Adiciona campo `number` sequencial por organização ao model Contact.
-- Escrita de forma IDEMPOTENTE para ser segura em ambientes
-- onde o schema divergiu ou foi parcialmente aplicado.

-- Passo 1: adicionar coluna nullable temporária (IF NOT EXISTS = idempotente)
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "number" INTEGER;

-- Passo 2: backfill com numeração sequencial por organização
-- (apenas onde number ainda é NULL — seguro rodar múltiplas vezes)
UPDATE "contacts"
SET "number" = sub."rn"
FROM (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM "contacts"
  WHERE "number" IS NULL
) AS sub
WHERE "contacts".id = sub.id;

-- Passo 3: tornar NOT NULL (todos os registros têm valor agora)
ALTER TABLE "contacts" ALTER COLUMN "number" SET NOT NULL;

-- Passo 4: constraint UNIQUE por organização + índice (idempotentes)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_organization_id_number_key'
  ) THEN
    ALTER TABLE "contacts"
      ADD CONSTRAINT "contacts_organization_id_number_key"
      UNIQUE ("organization_id", "number");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "contacts_organization_id_number_idx"
  ON "contacts" ("organization_id", "number");
