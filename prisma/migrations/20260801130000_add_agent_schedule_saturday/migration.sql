-- Expediente de sabado por consultor (Distribuicao). Aditivo e seguro:
-- desligado por padrao => sabado segue fora do expediente ate ser ligado.
ALTER TABLE "agent_schedules"
  ADD COLUMN IF NOT EXISTS "saturdayEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "saturdayStart" TEXT NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS "saturdayEnd" TEXT NOT NULL DEFAULT '13:00';
