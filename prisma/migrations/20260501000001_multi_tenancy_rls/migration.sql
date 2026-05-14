-- Multi-tenancy RLS (Row-Level Security).
--
-- Ultima barreira de isolamento entre orgs. Se a Prisma Extension falhar
-- (bug, query raw sem filtro, script executado sem contexto), o Postgres
-- bloqueia a query. So passa quem tiver `app.organization_id` setada via
-- `set_config()` ou `SET LOCAL`.
--
-- ATENCAO — estrategia de ativacao gradual:
-- 1. Esta migration CRIA policies em todas as tabelas scoped mas deixa
--    RLS DESABILITADA (FORCE RLS inativo). Nenhum efeito pratico agora.
-- 2. Quando o app estiver executando `set_config` em cada request (ver
--    TODO no src/lib/auth-helpers.ts::withOrgContext), ligar RLS por
--    tabela em hot-fix manual.
-- 3. Validar em dev com 2 orgs antes de ligar em prod.
--
-- Comandos manuais pra ligar RLS depois de validar (um por tabela ou
-- DO block aplicando em todas):
--   ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE <table> FORCE ROW LEVEL SECURITY; -- aplica ate pra owner
--
-- Comando de desligamento de emergencia (se algo quebrar):
--   ALTER TABLE <table> DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- Helper: funcao que retorna orgId corrente (null se nao setado)
-- ============================================================

CREATE OR REPLACE FUNCTION current_organization_id() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')
$$;

-- Retorna true se a request marcou super-admin (bypass da policy).
CREATE OR REPLACE FUNCTION current_is_super_admin() RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.is_super_admin', true), '')::boolean, false)
$$;

-- ============================================================
-- Criar policies em cada tabela tenant-scoped
-- ============================================================

DO $$
DECLARE
  tbl text;
  scoped_tables text[] := ARRAY[
    'contacts','contact_phone_changes','companies','tags','custom_fields',
    'contact_custom_field_values','deal_custom_field_values','product_custom_field_values',
    'pipelines','stages','deals','deal_products','deal_events','products',
    'activities','notes','conversations','messages','whatsapp_call_events',
    'scheduled_whatsapp_calls','scheduled_messages','automations','automation_steps',
    'automation_logs','automation_contexts','channels','baileys_auth_keys',
    'quick_replies','message_templates','whatsapp_template_configs',
    'distribution_rules','distribution_members','segments','campaigns',
    'campaign_recipients','loss_reasons','api_tokens','mobile_layout_config',
    'user_dashboard_layouts','web_push_subscriptions','agent_schedules',
    'agent_statuses','agent_presence_logs','ai_agent_configs',
    'ai_agent_knowledge_docs','ai_agent_knowledge_chunks','ai_agent_runs',
    'ai_agent_messages','organization_invites'
  ];
BEGIN
  FOREACH tbl IN ARRAY scoped_tables LOOP
    -- Remove policy anterior caso exista (idempotencia entre deploys).
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS super_admin_bypass ON %I', tbl);

    -- Policy padrao: orgId casa com o GUC.
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
      USING ("organizationId" = current_organization_id())
      WITH CHECK ("organizationId" = current_organization_id())
    $f$, tbl);

    -- Policy de bypass pra super-admin EduIT — sempre passa.
    EXECUTE format($f$
      CREATE POLICY super_admin_bypass ON %I
      USING (current_is_super_admin())
      WITH CHECK (current_is_super_admin())
    $f$, tbl);
  END LOOP;
END $$;

-- ============================================================
-- Users: policy especifica (organizationId pode ser NULL pra super-admin)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation ON "users";
DROP POLICY IF EXISTS super_admin_bypass ON "users";

CREATE POLICY tenant_isolation ON "users"
USING (
  "organizationId" = current_organization_id()
  OR "isSuperAdmin" = true
)
WITH CHECK (
  "organizationId" = current_organization_id()
  OR "isSuperAdmin" = true
);

CREATE POLICY super_admin_bypass ON "users"
USING (current_is_super_admin())
WITH CHECK (current_is_super_admin());

-- ============================================================
-- RLS fica DESABILITADA por padrao. Ligar manualmente quando o
-- set_config() estiver funcionando nos wrappers. Comando pronto:
--
--   ALTER TABLE contacts          ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE contacts          FORCE ROW LEVEL SECURITY;
--   ... (uma linha por tabela)
-- ============================================================
