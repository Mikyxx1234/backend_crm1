-- ETL de importação de negócios (deals) — novo valor no enum BulkOperationType.
-- O etl-worker roteia jobs DEAL_IMPORT para o handler que processa o arquivo
-- em lote (createMany), suportando bases grandes (10k+ linhas).
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
