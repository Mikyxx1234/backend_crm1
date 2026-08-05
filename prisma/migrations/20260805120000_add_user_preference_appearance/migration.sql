-- Tema UI por usuario (NAO tenant-scoped; chave = userId).
-- Aditivo e idempotente: apenas adiciona a coluna JSONB nullable em
-- user_preferences. Shape: { theme: "light" | "dark" | null }.
-- migration-safety: ignore (coluna nullable, sem default volumoso, sem backfill).

ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "appearance" JSONB;
