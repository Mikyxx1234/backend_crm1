-- Tabulação aplicada quando o encerramento é AUTOMÁTICO (IA de encerramento
-- acadêmico, step `finish_conversation`). Sem ela o fechamento automático
-- driblava o `requireTabulationOnClose` e não aparecia no dashboard.
-- migration-safety: ignore (coluna nova, nullable).

ALTER TABLE "departments"
  ADD COLUMN IF NOT EXISTS "autoCloseTabulationId" TEXT;

-- AddForeignKey (guarded — Postgres não tem ADD CONSTRAINT IF NOT EXISTS)
DO $$ BEGIN
  ALTER TABLE "departments" ADD CONSTRAINT "departments_autoCloseTabulationId_fkey" FOREIGN KEY ("autoCloseTabulationId") REFERENCES "tabulations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
