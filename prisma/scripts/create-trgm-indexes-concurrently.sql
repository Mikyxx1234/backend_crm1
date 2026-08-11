-- Rodar manualmente em produção (fora do prisma migrate), como superuser:
--   psql "$DATABASE_URL" -f prisma/scripts/create-trgm-indexes-concurrently.sql
--
-- CREATE INDEX CONCURRENTLY não pode rodar dentro de transaction.
-- Cada índice é independente; falha parcial é ok (IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "deals_title_trgm_idx"
  ON "deals" USING GIN ("title" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "contacts_name_trgm_idx"
  ON "contacts" USING GIN ("name" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "contacts_email_trgm_idx"
  ON "contacts" USING GIN ("email" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "contacts_phone_trgm_idx"
  ON "contacts" USING GIN ("phone" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "dcfv_value_trgm_idx"
  ON "deal_custom_field_values" USING GIN ("value" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ccfv_value_trgm_idx"
  ON "contact_custom_field_values" USING GIN ("value" gin_trgm_ops);
