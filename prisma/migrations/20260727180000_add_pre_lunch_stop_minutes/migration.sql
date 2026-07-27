-- Minutos antes do almoço em que o consultor para de receber leads (Distribuição).
ALTER TABLE "distribution_responsibles"
  ADD COLUMN IF NOT EXISTS "preLunchStopMinutes" INTEGER NOT NULL DEFAULT 30;
