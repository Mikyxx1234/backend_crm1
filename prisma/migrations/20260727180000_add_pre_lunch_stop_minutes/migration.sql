-- Minutos antes do almoco em que o consultor para de receber leads (Distribuicao).
ALTER TABLE "distribution_responsibles"
  ADD COLUMN IF NOT EXISTS "preLunchStopMinutes" INTEGER NOT NULL DEFAULT 30;
