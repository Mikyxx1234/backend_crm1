-- Busca livre por CPF / RGM / matrícula em campos personalizados.
--
-- `findCustomFieldMatchesByDigits` compara o valor NORMALIZADO (só dígitos)
-- com LIKE '%digits%', para casar máscara ("123.456.789-00") contra o termo
-- digitado sem pontuação. Os índices trgm em `value` cru de
-- 20260811180000_trgm_search_indexes não servem: o predicado é sobre a
-- expressão, não sobre a coluna.
--
-- Idempotente: IF NOT EXISTS. Em produção com tabela grande, prefira o script
-- `prisma/scripts/create-trgm-indexes-concurrently.sql` (CONCURRENTLY não roda
-- dentro da transaction do `prisma migrate deploy`).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "deal_cfv_value_digits_trgm_idx"
  ON "deal_custom_field_values"
  USING GIN ((regexp_replace(value, '\D', '', 'g')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "contact_cfv_value_digits_trgm_idx"
  ON "contact_custom_field_values"
  USING GIN ((regexp_replace(value, '\D', '', 'g')) gin_trgm_ops);
