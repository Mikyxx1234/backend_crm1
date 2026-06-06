-- Distribuicao Inteligente — fila de espera (DistributionPending).
-- Leads que nao puderam ser distribuidos (NO_ELIGIBLE_RESPONSIBLE) ficam
-- aqui e sao redistribuidos quando alguem volta a ficar ONLINE.
-- RLS no mesmo padrao canonico (organization_widgets / distribution_*):
-- policies criadas, RLS deixada DESABILITADA (isolamento ativo via Prisma
-- Extension + getOrgIdOrThrow).
--
-- migration-safety: ignore (tabela nova; nao altera dados existentes).

CREATE TABLE IF NOT EXISTS "distribution_pending" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "dealId"           TEXT,
  "contactId"        TEXT,
  "conversationId"   TEXT,
  "distributionType" TEXT,
  "triggerSource"    TEXT NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'PENDING',
  "attempts"         INTEGER NOT NULL DEFAULT 1,
  "lastAttemptAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedUserId"   TEXT,
  "resolvedAt"       TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "distribution_pending_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "distribution_pending_org_status_idx"
  ON "distribution_pending" ("organizationId", "status");

DROP POLICY IF EXISTS tenant_isolation ON "distribution_pending";
DROP POLICY IF EXISTS super_admin_bypass ON "distribution_pending";

CREATE POLICY tenant_isolation ON "distribution_pending"
USING ("organizationId" = current_organization_id())
WITH CHECK ("organizationId" = current_organization_id());

CREATE POLICY super_admin_bypass ON "distribution_pending"
USING (current_is_super_admin())
WITH CHECK (current_is_super_admin());
