-- Migration: Catálogo Genérico por Capacidades — Fase 1.
-- Adiciona `mode`, `overridePolicy`, `unitOverrides` às junctions de capacidade
-- e faz backfill idempotente do `mode` por capacidade segundo as regras de
-- MAPEAMENTO.md §4. 100% aditiva e idempotente (IF NOT EXISTS + DO blocks),
-- alinhada à convenção das migrations anteriores (aplicação manual em dev/prod
-- via SKIP_PRISMA_MIGRATE=1).
--
-- Não dropa `Product.stock`/`trackStock` — apenas anotados como @deprecated no
-- schema. Drop fica para pós-Fase 7 (cfr. MAPEAMENTO.md §6).

-- =========================================================================
-- 1. Enum OverridePolicy
-- =========================================================================
DO $$ BEGIN
  CREATE TYPE "OverridePolicy" AS ENUM ('LOCKED', 'DEFAULT', 'OPEN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =========================================================================
-- 2. CatalogCapability: + mode, + overridePolicy
-- =========================================================================
ALTER TABLE "catalog_capabilities"
  ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'default';

ALTER TABLE "catalog_capabilities"
  ADD COLUMN IF NOT EXISTS "overridePolicy" "OverridePolicy" NOT NULL DEFAULT 'DEFAULT';

-- =========================================================================
-- 3. ProductCapability: + mode, + unitOverrides
-- =========================================================================
ALTER TABLE "product_capabilities"
  ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'default';

ALTER TABLE "product_capabilities"
  ADD COLUMN IF NOT EXISTS "unitOverrides" JSONB;

-- =========================================================================
-- 4. Backfill de `mode` por capacidade (idempotente — só toca rows com
--    mode='default' que é o sentinel da coluna recém-criada).
--
--    Regras de inferência seguem MAPEAMENTO.md §4. Para capabilities cuja
--    inferência depende do produto (allocation, fulfillment, scheduling,
--    stakeholders), o ProductCapability é refinado pelo kind do produto;
--    o CatalogCapability fica num default seguro (refinável manualmente
--    via wizard depois).
-- =========================================================================

-- 4.1 CatalogCapability — defaults por capability key
UPDATE "catalog_capabilities" SET "mode" = 'one_time'     WHERE "capabilityKey" = 'pricing'      AND "mode" = 'default';
UPDATE "catalog_capabilities" SET "mode" = 'units'        WHERE "capabilityKey" = 'allocation'   AND "mode" = 'default';
UPDATE "catalog_capabilities" SET "mode" = 'appointment'  WHERE "capabilityKey" = 'scheduling'   AND "mode" = 'default';
UPDATE "catalog_capabilities" SET "mode" = 'physical'     WHERE "capabilityKey" = 'shipping'     AND "mode" = 'default';
UPDATE "catalog_capabilities" SET "mode" = 'subscription' WHERE "capabilityKey" = 'recurrence'   AND "mode" = 'default';
UPDATE "catalog_capabilities" SET "mode" = 'deliverables' WHERE "capabilityKey" = 'fulfillment'  AND "mode" = 'default';
UPDATE "catalog_capabilities" SET "mode" = 'customer'     WHERE "capabilityKey" = 'stakeholders' AND "mode" = 'default';
UPDATE "catalog_capabilities" SET "mode" = 'freeform'     WHERE "capabilityKey" = 'custom_data'  AND "mode" = 'default';

-- 4.2 ProductCapability — inicia com o mesmo modo do CatalogCapability quando existir
UPDATE "product_capabilities" pc SET "mode" = cc."mode"
  FROM "products" p, "catalog_capabilities" cc
  WHERE pc."productId" = p."id"
    AND p."catalogId" = cc."catalogId"
    AND pc."capabilityKey" = cc."capabilityKey"
    AND pc."mode" = 'default';

-- 4.3 ProductCapability — refinamento por kind do produto (capacidades
--     que dependem do tipo do negócio). Estas regras são a tradução do
--     enum legado ProductKind para o modo da capacidade `fulfillment`,
--     respeitando a quarentena imposta no .cursorrules: leitura única
--     deste campo, exclusivamente para o backfill.
UPDATE "product_capabilities" pc SET "mode" = 'enrollment'
  FROM "products" p
  WHERE pc."productId" = p."id"
    AND pc."capabilityKey" = 'fulfillment'
    AND p."kind" = 'COURSE'
    AND pc."mode" IN ('default', 'deliverables');

UPDATE "product_capabilities" pc SET "mode" = 'recruiting'
  FROM "products" p
  WHERE pc."productId" = p."id"
    AND pc."capabilityKey" = 'fulfillment'
    AND p."kind" = 'JOB_OPENING'
    AND pc."mode" IN ('default', 'deliverables');

UPDATE "product_capabilities" pc SET "mode" = 'delivery'
  FROM "products" p
  JOIN "product_shipping" ps ON ps."productId" = p."id"
  WHERE pc."productId" = p."id"
    AND pc."capabilityKey" = 'fulfillment'
    AND p."kind" = 'PHYSICAL'
    AND pc."mode" IN ('default', 'deliverables');

-- 4.4 ProductCapability — allocation refinada por kind (vagas = seats)
UPDATE "product_capabilities" pc SET "mode" = 'seats'
  FROM "products" p
  WHERE pc."productId" = p."id"
    AND pc."capabilityKey" = 'allocation'
    AND p."kind" = 'JOB_OPENING'
    AND pc."mode" IN ('default', 'units');

-- 4.5 ProductCapability — stakeholders refinada por kind
UPDATE "product_capabilities" pc SET "mode" = 'student'
  FROM "products" p
  WHERE pc."productId" = p."id"
    AND pc."capabilityKey" = 'stakeholders'
    AND p."kind" = 'COURSE'
    AND pc."mode" IN ('default', 'customer');

UPDATE "product_capabilities" pc SET "mode" = 'client'
  FROM "products" p
  WHERE pc."productId" = p."id"
    AND pc."capabilityKey" = 'stakeholders'
    AND p."kind" = 'JOB_OPENING'
    AND pc."mode" IN ('default', 'customer');

-- 4.6 ProductCapability — scheduling refinada por kind
UPDATE "product_capabilities" pc SET "mode" = 'classes'
  FROM "products" p
  WHERE pc."productId" = p."id"
    AND pc."capabilityKey" = 'scheduling'
    AND p."kind" = 'COURSE'
    AND pc."mode" IN ('default', 'appointment');

UPDATE "product_capabilities" pc SET "mode" = 'interview'
  FROM "products" p
  WHERE pc."productId" = p."id"
    AND pc."capabilityKey" = 'scheduling'
    AND p."kind" = 'JOB_OPENING'
    AND pc."mode" IN ('default', 'appointment');

-- 4.7 ProductCapability — fallback genérico (nada combinou: aplica default
--     da capacidade igual ao do catálogo). Idempotente: só atinge rows
--     ainda com 'default'.
UPDATE "product_capabilities" SET "mode" = 'one_time'     WHERE "capabilityKey" = 'pricing'      AND "mode" = 'default';
UPDATE "product_capabilities" SET "mode" = 'units'        WHERE "capabilityKey" = 'allocation'   AND "mode" = 'default';
UPDATE "product_capabilities" SET "mode" = 'appointment'  WHERE "capabilityKey" = 'scheduling'   AND "mode" = 'default';
UPDATE "product_capabilities" SET "mode" = 'physical'     WHERE "capabilityKey" = 'shipping'     AND "mode" = 'default';
UPDATE "product_capabilities" SET "mode" = 'subscription' WHERE "capabilityKey" = 'recurrence'   AND "mode" = 'default';
UPDATE "product_capabilities" SET "mode" = 'deliverables' WHERE "capabilityKey" = 'fulfillment'  AND "mode" = 'default';
UPDATE "product_capabilities" SET "mode" = 'customer'     WHERE "capabilityKey" = 'stakeholders' AND "mode" = 'default';
UPDATE "product_capabilities" SET "mode" = 'freeform'     WHERE "capabilityKey" = 'custom_data'  AND "mode" = 'default';
