-- ============================================================
-- Índices de performance para lookups de import (T2)
-- ============================================================
--
-- POR QUE MANUAL (fora do prisma migrate):
--   - `CREATE INDEX CONCURRENTLY` NÃO pode rodar dentro de transação, e o
--     `prisma migrate deploy` envolve cada migration numa transação → falharia.
--   - Sem CONCURRENTLY, o `CREATE INDEX` pega lock de escrita na tabela durante
--     o build. Como estas tabelas são COMPARTILHADAS entre todos os tenants,
--     isso bloquearia writes de OUTRAS orgs. CONCURRENTLY evita esse bloqueio.
--
-- COMO RODAR (produção, em janela de menor uso):
--   psql "$DATABASE_URL" -f prisma/manual/20260716_import_perf_indexes.sql
--   (rode fora de transação — psql executa statement a statement por padrão;
--    NÃO envolva em BEGIN/COMMIT.)
--
-- São idempotentes (IF NOT EXISTS). Se um índice ficar INVALID por falha no
-- build concorrente, dropar com DROP INDEX CONCURRENTLY <nome>; e re-rodar.
--
-- Observação sobre drift do Prisma: índices FUNCIONAIS (lower(...)) não são
-- representáveis no schema.prisma. Eles vivem só aqui. Um futuro
-- `prisma migrate dev` pode tentar dropá-los por "drift" — não rode migrate dev
-- contra o banco de produção. `prisma migrate deploy` ignora índices não
-- declarados.

-- Lookup crítico: contato por e-mail case-insensitive (lower(email)).
-- Hoje o código usa `email ILIKE $1` (mode:"insensitive"), que NÃO usa o btree
-- simples; o índice funcional abaixo é o que o planner passa a usar quando a
-- query compara `lower(email) = lower($1)`.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_org_lower_email
  ON contacts ("organizationId", lower(email));

-- Fallback de deduplicação de deal por (org, contato, título) no import.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_org_contact_title
  ON deals ("organizationId", "contactId", title);

-- Resolução de etapa por nome case-insensitive (pipeline_name+stage_name).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stages_org_lower_name
  ON stages ("organizationId", lower(name));

-- Resolução de responsável/owner por e-mail case-insensitive.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_lower_email
  ON users (lower(email));

-- Atualiza estatísticas do planner após criar os índices.
ANALYZE contacts;
ANALYZE deals;
ANALYZE stages;
ANALYZE users;
