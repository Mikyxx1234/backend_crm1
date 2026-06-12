-- Migration: contact_sequential_number
-- Adiciona campo `number` sequencial por organização ao model Contact,
-- seguindo o mesmo padrão do model Deal (services/contacts.ts gerencia max+1).
--
-- 1. Adiciona a coluna com default temporário 0 (evita violação NOT NULL)
-- 2. Backfill: atribui ROW_NUMBER() por org ordenado por created_at
-- 3. Remove o default temporário
-- 4. Adiciona constraint NOT NULL + UNIQUE + índices

-- Passo 1: adicionar coluna nullable temporária
ALTER TABLE "contacts" ADD COLUMN "number" INTEGER;

-- Passo 2: backfill com numeração sequencial por organização
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
) AS sub
WHERE "contacts".id = sub.id;

-- Passo 3: tornar NOT NULL (todos os registros têm valor agora)
ALTER TABLE "contacts" ALTER COLUMN "number" SET NOT NULL;

-- Passo 4: constraint UNIQUE por organização + índice
ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_organization_id_number_key"
  UNIQUE ("organization_id", "number");

CREATE INDEX IF NOT EXISTS "contacts_organization_id_number_idx"
  ON "contacts" ("organization_id", "number");
