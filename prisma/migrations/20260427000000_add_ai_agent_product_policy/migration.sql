-- Adiciona campo `productPolicy` ao AIAgentConfig.
--
-- É uma política de apresentação de produtos específica para agentes
-- que têm a tool `search_products` habilitada. Fica separada do
-- `systemPromptOverride` porque só faz sentido quando o agente
-- realmente pode consultar o catálogo.
--
-- Idempotente: IF NOT EXISTS para permitir retry de `prisma migrate deploy`.

ALTER TABLE "ai_agent_configs"
  ADD COLUMN IF NOT EXISTS "productPolicy" TEXT;
