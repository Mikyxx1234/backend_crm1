-- Bulk Operations
-- Registra operações em massa enfileiradas (BullMQ) e processadas por
-- workers fora do backend-api. Postgres é a fonte da verdade do
-- progresso/histórico — o estado no BullMQ é volátil e existe apenas
-- enquanto o job está na fila/processamento.
--
-- Escopo inicial: operações sobre Deals. O enum BulkOperationType é
-- expansível para futuras operações pesadas.
--
-- Idempotente: IF NOT EXISTS nos objetos criados para permitir retry
-- de `prisma migrate deploy` se o primeiro run falhar. Em ambientes
-- com SKIP_PRISMA_MIGRATE=1 (test apontando para banco do monólito),
-- aplicar manualmente com:
--   psql "$DATABASE_URL" -f prisma/migrations/20260522180000_add_bulk_operations/migration.sql

-- Enum do tipo da operação
DO $$ BEGIN
    CREATE TYPE "BulkOperationType" AS ENUM (
      'DEAL_BULK_UPDATE_FIELDS',
      'DEAL_BULK_MOVE_STAGE',
      'DEAL_BULK_CHANGE_OWNER',
      'DEAL_BULK_MARK_WON',
      'DEAL_BULK_MARK_LOST',
      'DEAL_BULK_DELETE'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Enum do status do ciclo de vida
DO $$ BEGIN
    CREATE TYPE "BulkOperationStatus" AS ENUM (
      'PENDING',
      'PROCESSING',
      'COMPLETED',
      'PARTIAL',
      'FAILED',
      'CANCELLED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Tabela principal
CREATE TABLE IF NOT EXISTS "bulk_operations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "BulkOperationType" NOT NULL,
    "status" "BulkOperationStatus" NOT NULL DEFAULT 'PENDING',
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "payload" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "bulk_operations_pkey" PRIMARY KEY ("id")
);

-- Indexes:
--  * (organizationId, status)        -> dashboard "minhas operações em andamento"
--  * (organizationId, createdAt)     -> histórico ordenado por data
--  * (organizationId, type, status)  -> auditoria por tipo de operação
CREATE INDEX IF NOT EXISTS "bulk_operations_organizationId_status_idx"
  ON "bulk_operations"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "bulk_operations_organizationId_createdAt_idx"
  ON "bulk_operations"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "bulk_operations_organizationId_type_status_idx"
  ON "bulk_operations"("organizationId", "type", "status");

-- FKs
DO $$ BEGIN
    ALTER TABLE "bulk_operations"
      ADD CONSTRAINT "bulk_operations_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "bulk_operations"
      ADD CONSTRAINT "bulk_operations_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
