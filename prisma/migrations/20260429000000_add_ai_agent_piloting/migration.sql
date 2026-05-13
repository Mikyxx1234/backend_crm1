-- Piloting (controles operacionais) do agente de IA.
--
-- Adiciona capacidades que moram ACIMA do prompt:
--   • Saudação inicial (primeira resposta fixa).
--   • Handoff por inatividade (timer + destino configurável).
--   • Palavras-chave que forçam handoff imediato.
--   • Perguntas obrigatórias de qualificação.
--   • Horário de atendimento (businessHours) com mensagem off-hours.
--   • Estilo de saída (conversational vs structured) pra reforçar
--     proibição de "ficha técnica" com bullets.
--
-- Todos os campos são idempotentes (IF NOT EXISTS) pra permitir
-- retry de `prisma migrate deploy`.

ALTER TABLE "ai_agent_configs"
  ADD COLUMN IF NOT EXISTS "openingMessage" TEXT,
  ADD COLUMN IF NOT EXISTS "openingDelayMs" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "inactivityTimerMs" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "inactivityHandoffMode" TEXT NOT NULL DEFAULT 'KEEP_OWNER',
  ADD COLUMN IF NOT EXISTS "inactivityHandoffUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "inactivityFarewellMessage" TEXT,
  ADD COLUMN IF NOT EXISTS "keywordHandoffs" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "qualificationQuestions" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "businessHours" JSONB,
  ADD COLUMN IF NOT EXISTS "outputStyle" TEXT NOT NULL DEFAULT 'conversational';

-- Índice usado pelo worker de inatividade (varrer agentes com timer ativo).
CREATE INDEX IF NOT EXISTS "ai_agent_configs_inactivity_idx"
  ON "ai_agent_configs" ("active", "inactivityTimerMs")
  WHERE "inactivityTimerMs" > 0;
