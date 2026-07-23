-- Encerramento em massa de conversas (inbox) — novo valor no enum BulkOperationType.
-- O leads-worker roteia jobs CONVERSATION_BULK_RESOLVE para o handler
-- `bulk-resolve-conversations`, que encerra as conversas em chunks e registra
-- progresso no BulkOperation (mesma infra usada pelos bulk de Deals).
--
-- migration-safety: ignore (ADD VALUE em enum é aditivo; idempotente via guard).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'BulkOperationType' AND e.enumlabel = 'CONVERSATION_BULK_RESOLVE'
  ) THEN
    ALTER TYPE "BulkOperationType" ADD VALUE 'CONVERSATION_BULK_RESOLVE';
  END IF;
END
$$;
