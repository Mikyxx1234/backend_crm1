-- Índices GIN pg_trgm para busca ILIKE (%x%) em board/inbox.
-- Idempotente: IF NOT EXISTS (seguro se já aplicados manualmente em prod).
--
-- NOTA: CREATE INDEX CONCURRENTLY não roda dentro da transaction do
-- `prisma migrate deploy`. Em produção com tabela grande, prefira o
-- script `prisma/scripts/create-trgm-indexes-concurrently.sql`.
-- Esta migration garante o schema em ambientes menores / novos.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "deals_title_trgm_idx"
  ON "deals" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "contacts_name_trgm_idx"
  ON "contacts" USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "contacts_email_trgm_idx"
  ON "contacts" USING GIN ("email" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "contacts_phone_trgm_idx"
  ON "contacts" USING GIN ("phone" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "dcfv_value_trgm_idx"
  ON "deal_custom_field_values" USING GIN ("value" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "ccfv_value_trgm_idx"
  ON "contact_custom_field_values" USING GIN ("value" gin_trgm_ops);
