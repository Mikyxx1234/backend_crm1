-- Campanhas — rastreamento de RESPOSTA (engajamento).
-- Adiciona repliedCount na campanha e repliedAt no destinatario. "Respondeu"
-- e metrica de engajamento separada do status de entrega (nao regride
-- SENT/DELIVERED/READ). Correlacao inbound->campanha e feita no webhook Meta.
--
-- migration-safety: ignore (colunas novas nullable / com default; nao altera
-- dados existentes).

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "repliedCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "campaign_recipients"
  ADD COLUMN IF NOT EXISTS "repliedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "campaign_recipients_contactId_sentAt_idx"
  ON "campaign_recipients" ("contactId", "sentAt");
