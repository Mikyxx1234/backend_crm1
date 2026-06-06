-- Central de Widgets: estado de instalacao das extensoes internas por org.
-- A DEFINICAO de cada widget vive no catalogo estatico
-- (src/lib/widget-catalog.ts); esta tabela guarda apenas o estado por org.
-- migration-safety: ignore (criacao de tabela nova; tudo idempotente).

CREATE TABLE "organization_widgets" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "widgetSlug"     TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'ACTIVE',
  "installedById"  TEXT,
  "config"         JSONB,
  "installedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organization_widgets_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "organization_widgets_org_slug_key"
  ON "organization_widgets" ("organizationId", "widgetSlug");

CREATE INDEX "organization_widgets_organizationId_idx"
  ON "organization_widgets" ("organizationId");

CREATE INDEX "organization_widgets_widgetSlug_idx"
  ON "organization_widgets" ("widgetSlug");

-- ============================================================
-- RLS: espelha o padrao canonico das tabelas tenant-scoped
-- (ver 20260501000001_multi_tenancy_rls). Cria as policies
-- tenant_isolation + super_admin_bypass usando os mesmos helpers,
-- mas deixa RLS DESABILITADA (sem ENABLE/FORCE) — igual as demais
-- tabelas. O isolamento ativo hoje e feito na camada de aplicacao
-- (Prisma Extension + getOrgIdOrThrow). Para ligar a RLS no futuro,
-- quando withOrgContext executar set_config('app.organization_id'):
--   ALTER TABLE "organization_widgets" ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE "organization_widgets" FORCE ROW LEVEL SECURITY;
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation ON "organization_widgets";
DROP POLICY IF EXISTS super_admin_bypass ON "organization_widgets";

CREATE POLICY tenant_isolation ON "organization_widgets"
USING ("organizationId" = current_organization_id())
WITH CHECK ("organizationId" = current_organization_id());

CREATE POLICY super_admin_bypass ON "organization_widgets"
USING (current_is_super_admin())
WITH CHECK (current_is_super_admin());
