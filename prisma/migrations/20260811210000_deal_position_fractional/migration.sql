-- Deal.position Int -> Float (indexação fracionária / "fractional indexing").
-- moveDeal passa a gravar o ponto médio entre os vizinhos em vez de fazer
-- shift em massa (`position = position + 1` reescrevia milhares de rows por
-- drag-and-drop — ~900ms por move, top-3 de CPU no pg_stat_statements).
-- Valores inteiros existentes são preservados (1 -> 1.0); a ordenação
-- ORDER BY position permanece idêntica.
ALTER TABLE "deals" ALTER COLUMN "position" TYPE double precision;
