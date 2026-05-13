-- Index isolado em messages.createdAt para acelerar o relatório
-- /api/reports/messaging que filtra mensagens por intervalo de datas
-- em todo o sistema (sem conversationId). Sem este index, o planner
-- precisa fazer sequential scan na tabela inteira ou usar índice
-- composto de forma subótima quando o volume cresce.
--
-- Usamos CONCURRENTLY para não bloquear writes na tabela messages
-- durante a criação (que pode demorar minutos em tabelas grandes).
-- IF NOT EXISTS torna a migration idempotente.

CREATE INDEX IF NOT EXISTS "messages_createdAt_idx" ON "messages" ("createdAt");
