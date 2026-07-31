-- Persiste a confiança auto-declarada pelo LLM ([CONFIANCA:X.X]) e o motivo
-- do handoff em cada run do agente de IA. Base pras métricas de qualidade
-- (confiança média, % de handoff por motivo) do painel de monitoramento.

ALTER TABLE "ai_agent_runs"
  ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION;

ALTER TABLE "ai_agent_runs"
  ADD COLUMN IF NOT EXISTS "handoffReason" TEXT;
