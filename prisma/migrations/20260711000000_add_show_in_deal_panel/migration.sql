-- Migration: add showInDealPanel to custom_fields
ALTER TABLE "custom_fields"
  ADD COLUMN IF NOT EXISTS "showInDealPanel" BOOLEAN NOT NULL DEFAULT false;
