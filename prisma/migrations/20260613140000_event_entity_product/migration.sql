-- Migration: adiciona PRODUCT ao enum EventEntityType (Fase 2 do catálogo).
-- Aditiva e idempotente. Usado por alertas de saldo baixo (ALLOCATION_LOW)
-- quando não há deal associado.
DO $$ BEGIN
  ALTER TYPE "EventEntityType" ADD VALUE IF NOT EXISTS 'PRODUCT';
EXCEPTION WHEN others THEN null; END $$;
