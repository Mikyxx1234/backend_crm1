-- ETL de importação de negócios — novo valor no enum BulkOperationType (T3/M1).
-- O etl-worker roteia jobs DEAL_IMPORT para o handler `deal-import`, que lê o
-- arquivo do bucket `imports` (base64 embutido no BulkOperation.payload como
-- fallback) e processa em chunks com pré-carga em lote.
--
-- migration-safety: ignore (ADD VALUE em enum é aditivo; idempotente via guard).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'BulkOperationType' AND e.enumlabel = 'DEAL_IMPORT'
  ) THEN
    ALTER TYPE "BulkOperationType" ADD VALUE 'DEAL_IMPORT';
  END IF;
END
$$;
