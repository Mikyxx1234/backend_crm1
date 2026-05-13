-- Rollback idempotente da migration 20260424000000_add_ai_agents.
-- Rode este script quando a migration falhou (ex.: P3009) e você
-- precisa deixar o banco limpo para que o próximo `prisma migrate
-- deploy` possa reaplicá-la do zero.
--
-- É seguro rodar mesmo que nenhum objeto tenha sido criado — todos
-- os DROPs usam IF EXISTS.
--
-- Uso (exemplo):
--   docker exec -i <container_postgres> psql -U <user> -d <db> \
--     < prisma/scripts/rollback-ai-agents-migration.sql

BEGIN;

-- Tabelas (ordem invertida das FKs).
DROP TABLE IF EXISTS "ai_agent_messages" CASCADE;
DROP TABLE IF EXISTS "ai_agent_runs" CASCADE;
DROP TABLE IF EXISTS "ai_agent_knowledge_chunks" CASCADE;
DROP TABLE IF EXISTS "ai_agent_knowledge_docs" CASCADE;
DROP TABLE IF EXISTS "ai_agent_configs" CASCADE;

-- Enums novos.
DROP TYPE IF EXISTS "AIAgentRunStatus";
DROP TYPE IF EXISTS "AIAgentKnowledgeStatus";
DROP TYPE IF EXISTS "AIAgentAutonomy";
DROP TYPE IF EXISTS "AIAgentArchetype";

-- Coluna e FK adicionadas em messages.
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_aiAgentUserId_fkey";
DROP INDEX IF EXISTS "messages_aiAgentUserId_createdAt_idx";
ALTER TABLE "messages" DROP COLUMN IF EXISTS "aiAgentUserId";

-- Coluna e tipo adicionados em users.
DROP INDEX IF EXISTS "users_type_idx";
ALTER TABLE "users" DROP COLUMN IF EXISTS "type";
DROP TYPE IF EXISTS "UserType";

-- Restaura NOT NULL em hashedPassword (caso tenha sido removido e você
-- queira voltar ao estado anterior). Só roda se existirem usuários —
-- se algum registro tiver hashedPassword NULL, o ALTER falha; nesse
-- caso, limpe/preencha antes ou deixe comentado.
-- ALTER TABLE "users" ALTER COLUMN "hashedPassword" SET NOT NULL;

-- Limpa o registro de migration falhada do Prisma, caso exista.
DELETE FROM "_prisma_migrations"
 WHERE migration_name = '20260424000000_add_ai_agents';

COMMIT;
