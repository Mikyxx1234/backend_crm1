-- ETL de importação de contatos — novo valor no enum BulkOperationType.
-- O etl-worker roteia jobs CONTACT_IMPORT para o handler de importação que lê
-- o arquivo do bucket `imports` no volume compartilhado.
--
-- migration-safety: ignore (ADD VALUE em enum é aditivo; idempotente via guard).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'BulkOperationType' AND e.enumlabel = 'CONTACT_IMPORT'
  ) THEN
    ALTER TYPE "BulkOperationType" ADD VALUE 'CONTACT_IMPORT';
  END IF;
END
$$;
