-- Feature flags por organizacao (PR 5.4).
-- migration-safety: ignore (criacao de tabela nova; tudo idempotente).

CREATE TABLE "organization_feature_flags" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "enabled"        BOOLEAN NOT NULL,
  "value"          JSONB,
  "setById"        TEXT,
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organization_feature_flags_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "organization_feature_flags_org_key_key"
  ON "organization_feature_flags" ("organizationId", "key");

CREATE INDEX "organization_feature_flags_organizationId_idx"
  ON "organization_feature_flags" ("organizationId");

-- RLS: orgs so leem/editam suas flags. Super-admins (sem
-- app.organization_id setado) tem bypass via BYPASSRLS no role
-- (mesmo padrao das outras tabelas tenant-scoped).
ALTER TABLE "organization_feature_flags" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feature_flags_tenant_isolation"
  ON "organization_feature_flags"
  USING ("organizationId" = current_setting('app.organization_id', true)::text);

CREATE POLICY "feature_flags_tenant_isolation_insert"
  ON "organization_feature_flags"
  FOR INSERT
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true)::text);
