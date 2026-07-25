-- Automation: permite disparo manual pelo agente (picker do composer),
-- independente do gatilho automático.
ALTER TABLE "automations"
  ADD COLUMN IF NOT EXISTS "allowManualRun" BOOLEAN NOT NULL DEFAULT false;
