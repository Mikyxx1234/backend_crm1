-- 14/ago/26 — ID amigável sequencial por org nas entidades de produto
-- que ainda só tinham CUID. Mesmo padrão de Contact/Deal/Pipeline.
-- Aditiva e idempotente.

-- Tabelas com createdAt
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'companies',
    'campaigns',
    'automations',
    'channels',
    'departments',
    'saved_filters',
    'products',
    'catalogs',
    'org_units',
    'distribution_rules',
    'message_templates',
    'quick_replies',
    'job_openings',
    'segments',
    'whatsapp_flow_definitions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS "number" INTEGER', t);
    EXECUTE format(
      'WITH numbered AS (
         SELECT id, ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", id) AS rn
         FROM %I
         WHERE "number" IS NULL
       )
       UPDATE %I x SET "number" = n.rn FROM numbered n WHERE x.id = n.id',
      t, t
    );
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "number" SET NOT NULL', t);
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I ("organizationId", "number")',
      t || '_organizationId_number_key',
      t
    );
  END LOOP;
END $$;

-- Tag e CustomField não têm createdAt
ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "number" INTEGER;
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY id) AS rn
  FROM "tags"
  WHERE "number" IS NULL
)
UPDATE "tags" x SET "number" = n.rn FROM numbered n WHERE x.id = n.id;
ALTER TABLE "tags" ALTER COLUMN "number" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "tags_organizationId_number_key"
  ON "tags"("organizationId", "number");

ALTER TABLE "custom_fields" ADD COLUMN IF NOT EXISTS "number" INTEGER;
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY id) AS rn
  FROM "custom_fields"
  WHERE "number" IS NULL
)
UPDATE "custom_fields" x SET "number" = n.rn FROM numbered n WHERE x.id = n.id;
ALTER TABLE "custom_fields" ALTER COLUMN "number" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "custom_fields_organizationId_number_key"
  ON "custom_fields"("organizationId", "number");

-- User: number só para quem tem org (super-admin sem org fica null)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "number" INTEGER;
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", id) AS rn
  FROM "users"
  WHERE "number" IS NULL AND "organizationId" IS NOT NULL
)
UPDATE "users" x SET "number" = n.rn FROM numbered n WHERE x.id = n.id;
CREATE UNIQUE INDEX IF NOT EXISTS "users_organizationId_number_key"
  ON "users"("organizationId", "number");
