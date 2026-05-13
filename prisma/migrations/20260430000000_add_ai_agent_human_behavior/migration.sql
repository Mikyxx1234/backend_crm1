-- Comportamento humano do agente de IA: simula "digitando..." e
-- marca mensagem do cliente como lida (tracinhos azuis) antes de
-- responder. Ambos defaults em true para melhorar UX imediatamente
-- nos agentes existentes sem quebrar nada (os endpoints Meta são
-- idempotentes e tolerantes a falha).

ALTER TABLE "ai_agent_configs"
  ADD COLUMN IF NOT EXISTS "simulateTyping" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "typingPerCharMs" INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS "markMessagesRead" BOOLEAN NOT NULL DEFAULT true;
