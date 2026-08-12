-- Índice parcial para o stale-outbound-sweeper.
--
-- A query do sweeper (direction='out' AND sendStatus='sent' AND createdAt < cutoff
-- AND externalId IS NOT NULL ...) rodava como seq scan sobre `messages`:
-- ~470ms por chamada, 126k chamadas acumuladas (top-2 em tempo total no
-- pg_stat_statements de prod, ~32 mil segundos de CPU de banco).
--
-- Apenas uma fração ínfima das mensagens está em sendStatus='sent' com
-- externalId (janela entre aceite da Meta e webhook delivered/failed), então
-- o índice parcial cobre exatamente o predicado e fica minúsculo (16 kB em
-- prod). Com o orderBy createdAt no sweeper, o planner usa o índice para
-- filtro + ordenação: 471ms -> 0.02ms.
--
-- Aplicado em prod em 11/08/2026 via CREATE INDEX CONCURRENTLY equivalente
-- (esta migration é no-op lá graças ao IF NOT EXISTS).

CREATE INDEX IF NOT EXISTS "messages_stale_outbound_idx"
  ON "messages" ("createdAt")
  WHERE "direction" = 'out' AND "sendStatus" = 'sent' AND "externalId" IS NOT NULL;
