-- LGPD/GDPR data requests (PR 4.3).
--
-- Este migration adiciona:
--   1. Coluna users.isErased + users.erasedAt (soft-erase pra LGPD).
--   2. Tabela data_requests + enums DataRequestType, DataRequestStatus.
--
-- Migration safety:
--   - isErased default FALSE → seguro pra rollout (existing rows
--     ficam com FALSE).
--   - erasedAt NULL → idem.
--   - data_requests e nova tabela; criacao instantanea.

-- migration-safety: ignore (NOT NULL com DEFAULT em col nova e seguro
-- em Postgres 11+; rewrite e barato em users mesmo com volume).
ALTER TABLE "users"
  ADD COLUMN "isErased" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "erasedAt" TIMESTAMP(3);

CREATE INDEX "users_isErased_idx" ON "users" ("isErased");

-- Enums
CREATE TYPE "DataRequestType" AS ENUM ('EXPORT', 'ERASE');
CREATE TYPE "DataRequestStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'READY',
  'COMPLETED',
  'FAILED'
);

-- Tabela
CREATE TABLE "data_requests" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "requestedById"    TEXT,
  "type"             "DataRequestType" NOT NULL,
  "status"           "DataRequestStatus" NOT NULL DEFAULT 'PENDING',
  "downloadKey"      TEXT,
  "downloadSize"     INTEGER,
  "expiresAt"        TIMESTAMP(3),
  "startedAt"        TIMESTAMP(3),
  "completedAt"      TIMESTAMP(3),
  "error"            TEXT,
  "contentHash"      TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "data_requests_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "data_requests_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "data_requests_organizationId_createdAt_idx"
  ON "data_requests" ("organizationId", "createdAt");
CREATE INDEX "data_requests_userId_type_createdAt_idx"
  ON "data_requests" ("userId", "type", "createdAt");
CREATE INDEX "data_requests_status_createdAt_idx"
  ON "data_requests" ("status", "createdAt");

-- RLS: data_requests segue o padrao da PR 1.4 (tenant-scoped).
-- Super-admin bypassa via app.is_super_admin GUC.
ALTER TABLE "data_requests" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "data_requests_tenant_isolation"
  ON "data_requests"
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "organizationId" = current_setting('app.organization_id', true)
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "organizationId" = current_setting('app.organization_id', true)
  );
