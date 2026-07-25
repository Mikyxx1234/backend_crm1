-- ========================================================================
-- DEV: adicionar conversations.hasHumanReply (drift pós-jul/2026)
-- Idempotente — seguro reexecutar.
--
-- Causa: schema Prisma + código já usam hasHumanReply; migração
--   20260724150000_add_conversation_has_human_reply existe, mas o DB DEV
--   ainda não a aplicou. Qualquer conversation.update/find sem select
--   estreito (e filtros de abas do Inbox) quebram.
--
-- Preferência: rodar `npx prisma migrate deploy` no backend apontando ao
-- DATABASE_URL de DEV. Se migrate estiver bloqueado/SKIP, rode este SQL
-- no Postgres DEV e registre a migration (seção final).
--
-- Alinhado com:
--   prisma/migrations/20260724150000_add_conversation_has_human_reply/
--   prisma/manual/reconcile_prod_20260724.sql (seção hasHumanReply)
-- ========================================================================

-- (0) Diagnóstico
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'conversations' AND column_name = 'hasHumanReply'
) AS has_human_reply_col;

-- (1) Coluna + backfill + índice
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "hasHumanReply" BOOLEAN NOT NULL DEFAULT false;

UPDATE "conversations" c
SET "hasHumanReply" = true
WHERE EXISTS (
  SELECT 1 FROM "messages" m
  WHERE m."conversationId" = c."id"
    AND m."direction" = 'out'
    AND m."authorType" = 'human'
);

CREATE INDEX IF NOT EXISTS "conversations_organizationId_status_assignedToId_hasHumanRep_idx"
  ON "conversations" ("organizationId", "status", "assignedToId", "hasHumanReply");

-- (2) Registrar em _prisma_migrations (evita migrate deploy reaplicar)
-- Checksum = sha256 LF do migration.sql (mesmo do reconcile_prod_20260724.sql)
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text,
       '2d404dd4d0dd1246d72c832c11f19feaf730b117b01e01116caf78b79f7dfe1a',
       now(),
       '20260724150000_add_conversation_has_human_reply',
       NULL, NULL, now(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations" m
  WHERE m.migration_name = '20260724150000_add_conversation_has_human_reply'
    AND m.finished_at IS NOT NULL
);

-- (3) Verificação
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'conversations' AND column_name = 'hasHumanReply') AS has_human_reply_col,
  (SELECT count(*) FROM "_prisma_migrations"
     WHERE migration_name = '20260724150000_add_conversation_has_human_reply'
       AND finished_at IS NOT NULL) AS migration_recorded;
