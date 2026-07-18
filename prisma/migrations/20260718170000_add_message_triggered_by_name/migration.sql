-- ────────────────────────────────────────────────────────────────────────
-- Adiciona Message.triggeredByName (nome do agente que disparou a automação
-- manualmente via /api/automations/[id]/run).
--
-- Preenchido nas mensagens enviadas pelos steps quando o gatilho foi `manual`.
-- O inbox usa esse campo para exibir o selo "Manual" + o avatar (iniciais) do
-- agente ao lado do robô (colab), reproduzindo a mensagem enviada sem card de
-- status separado. NULL para envios automáticos/reativos e mensagens antigas.
--
-- Idempotente: IF NOT EXISTS (mesmo padrão das migrations de messages.channelId).
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "triggeredByName" TEXT;
