-- Layout do dashboard comercial por usuario (NAO tenant-scoped; chave = userId).
-- Aditivo e idempotente: apenas adiciona a coluna JSONB nullable em
-- user_preferences. Sem RLS por organizacao (isolamento por userId na app).
-- migration-safety: ignore (coluna nullable, sem default volumoso, sem backfill).

ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "dashboard" JSONB;
