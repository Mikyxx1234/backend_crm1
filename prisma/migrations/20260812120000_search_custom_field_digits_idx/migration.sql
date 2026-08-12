-- Busca livre por CPF / RGM / matrícula em campos personalizados.
--
-- `findCustomFieldMatchesByDigits` compara o valor NORMALIZADO (só dígitos)
-- com LIKE '%digits%' para casar máscara ("123.456.789-00") contra o termo
-- digitado sem pontuação. LIKE '%x%' não usa btree — precisa de GIN trgm.
--
-- Os índices em `value` cru (`dcfv_value_trgm_idx` / `ccfv_value_trgm_idx`)
-- aceleram o `contains` insensível da busca por texto (curso, polo, e-mail em
-- campo personalizado). Já existiam criados à mão em alguns ambientes — os
-- nomes aqui são os mesmos de propósito, para virar no-op onde já existem.
--
-- Todos com IF NOT EXISTS — seguros pra reaplicar.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  -- Sem permissão para criar extensão: a busca continua funcionando (seq scan).
  NULL;
END$$;

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS "deal_cfv_value_digits_trgm_idx"
    ON "deal_custom_field_values"
    USING GIN ((regexp_replace(value, '\D', '', 'g')) gin_trgm_ops);

  CREATE INDEX IF NOT EXISTS "contact_cfv_value_digits_trgm_idx"
    ON "contact_custom_field_values"
    USING GIN ((regexp_replace(value, '\D', '', 'g')) gin_trgm_ops);

  CREATE INDEX IF NOT EXISTS "dcfv_value_trgm_idx"
    ON "deal_custom_field_values" USING GIN (value gin_trgm_ops);

  CREATE INDEX IF NOT EXISTS "ccfv_value_trgm_idx"
    ON "contact_custom_field_values" USING GIN (value gin_trgm_ops);
EXCEPTION WHEN undefined_object THEN
  -- pg_trgm indisponível: segue sem os índices.
  NULL;
END$$;
