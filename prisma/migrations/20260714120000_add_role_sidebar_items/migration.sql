-- Sidebar por Papel (Role): adiciona coluna JSONB nullable com a
-- preferencia de menu lateral do papel. Quando null, o papel nao override
-- a sidebar e o usuario cai no catalogo padrao. Shape esperado:
--   { "items": [ { "key": "dashboard", "enabled": true, "order": 1 }, ... ] }
--
-- Aditivo e idempotente (IF NOT EXISTS) para permitir rerun sem quebrar
-- ambientes onde a migration ja foi aplicada manualmente.
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "sidebarItems" JSONB;
