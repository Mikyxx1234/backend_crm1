-- Distingue resposta HUMANA de resposta de automação/IA nas conversas.
-- Usado para classificar as abas do inbox (Aguardando x Respondidas) e a
-- Fila de distribuição: conversas atribuídas que só receberam aviso da
-- automação/IA devem continuar como trabalho pendente do consultor.

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "hasHumanReply" BOOLEAN NOT NULL DEFAULT false;

-- Backfill preciso: marca hasHumanReply=true quando a conversa JÁ TEVE qualquer
-- mensagem de saída autorada por um HUMANO (authorType = 'human'). Conversas
-- que só receberam saídas de automação/IA (authorType 'bot'/'system')
-- permanecem hasHumanReply=false — voltando para a aba "Entrada" (atendimento
-- pendente) e corrigindo as que estavam presas em "Respondidas" após o aviso
-- automático da distribuição.
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
