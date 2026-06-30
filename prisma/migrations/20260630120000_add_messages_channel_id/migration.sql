-- ────────────────────────────────────────────────────────────────────────
-- Adiciona FK Message -> Channel (snapshot do canal de origem da mensagem).
--
-- Origem: no schema.prisma da DEV_BRANCH o model Message já declara
--   channelId  String?
--   channelRef Channel? @relation(fields: [channelId], references: [id], onDelete: SetNull)
--   @@index([channelId])
-- mas a alteração foi feita via `prisma db push` no banco DEV e nunca virou
-- uma migration. Sem isso, o `prisma migrate deploy` em prod não criaria a
-- coluna e a aplicação quebraria ao tentar resolver `channelRef`.
--
-- Nullable: mensagens históricas (anteriores à feature) ficam sem vínculo.
-- ON DELETE SET NULL: se o canal for excluído, a mensagem fica órfã.
--
-- Idempotente: usa IF NOT EXISTS e DO/EXCEPTION para FK e índice (mesmo
-- padrão das migrations do módulo softphone e catalogo comercial).
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "channelId" TEXT;

DO $$ BEGIN
  ALTER TABLE "messages"
    ADD CONSTRAINT "messages_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "channels"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "messages_channelId_idx"
  ON "messages" ("channelId");
