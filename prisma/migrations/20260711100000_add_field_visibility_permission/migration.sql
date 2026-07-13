-- Migration: add canConfigureFieldVisibility to agent_permissions
ALTER TABLE "agent_permissions"
  ADD COLUMN IF NOT EXISTS "canConfigureFieldVisibility" BOOLEAN NOT NULL DEFAULT false;
