-- Índices otimizados para filtros avançados do Kanban.
--
-- ▸ deals.updatedAt    : filtro "atualizado em" por intervalo.
-- ▸ deals.closedAt     : filtro "fechado em" por intervalo.
-- ▸ deals.title (trgm) : busca por título com `contains` insensível.
-- ▸ custom_field_values: filtros por `customFieldId, value` (LIKE/eq/in).
--
-- Todos os índices são `CREATE INDEX IF NOT EXISTS` — seguros pra reaplicar.

CREATE INDEX IF NOT EXISTS "deals_org_updatedAt_idx"
  ON "deals" ("organizationId", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "deals_org_closedAt_idx"
  ON "deals" ("organizationId", "closedAt" DESC);

-- pg_trgm para `contains` em title (ILIKE %x%). Skip se a extensão
-- não estiver disponível (não bloqueia).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  -- ignora se não tiver permissão; o filtro funciona sem índice tb.
  NULL;
END$$;

CREATE INDEX IF NOT EXISTS "deals_title_trgm_idx"
  ON "deals" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "deal_custom_field_values_field_value_idx"
  ON "deal_custom_field_values" ("customFieldId", "value");

CREATE INDEX IF NOT EXISTS "contact_custom_field_values_field_value_idx"
  ON "contact_custom_field_values" ("customFieldId", "value");

-- Tag joins do board: a chave já cobre (dealId, tagId) — mas
-- buscar por tagId reverso (some/none) usa este:
CREATE INDEX IF NOT EXISTS "tags_on_deals_tagId_idx"
  ON "tags_on_deals" ("tagId");

CREATE INDEX IF NOT EXISTS "tags_on_contacts_tagId_idx"
  ON "tags_on_contacts" ("tagId");
