-- AlterTable: liga Message → WhatsAppTemplateConfig usado no envio outbound.
-- Resolve bug do resolver de Flow inbound: sem essa FK, o resolver caía em
-- "pega qualquer template config com flowId da org ordenado por updatedAt"
-- e em orgs com 2+ templates Flow gravava respostas no flow errado.
-- Coluna nullable: mensagens não-template, históricas, ou envios sem vínculo
-- identificado mantêm NULL (resolver tem fallback por flowMetaName + keys).
ALTER TABLE "messages" ADD COLUMN "template_config_id" TEXT;

-- onDelete: SET NULL — preserva histórico de mensagens se config for removido.
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_template_config_id_fkey"
  FOREIGN KEY ("template_config_id") REFERENCES "whatsapp_template_configs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Index dedicado: o resolver de Flow inbound consulta mensagens outbound por
-- conversationId + flow_token e usa template_config_id no select.
CREATE INDEX "messages_template_config_id_idx" ON "messages"("template_config_id");
