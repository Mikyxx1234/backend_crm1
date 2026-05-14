-- Idempotente: corrige ambientes onde 20260504120000 ainda não rodou ou falhou.
-- Compatível com PostgreSQL: se a coluna já existir, não faz nada.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "chatTheme" TEXT NOT NULL DEFAULT 'azul';
