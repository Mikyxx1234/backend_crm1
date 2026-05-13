-- Adds automatic presence tracking to AgentStatus.
-- lastActivityAt is fed by the client heartbeat (POST /api/agents/me/ping);
-- a BullMQ worker reaps stale sessions to AWAY/OFFLINE.

ALTER TABLE "agent_statuses"
  ADD COLUMN IF NOT EXISTS "lastActivityAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "agent_statuses_status_lastActivityAt_idx"
  ON "agent_statuses" ("status", "lastActivityAt");
