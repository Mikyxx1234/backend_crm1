-- Multi-tenancy init.
--
-- Transformacao de single-tenant pra shared-schema multi-tenant:
--   1. Cria tabelas organizations + organization_invites + enum OrgStatus.
--   2. Adiciona coluna "organizationId" (NULLABLE) em todas as ~47 tabelas
--      tenant-scoped + colunas "organizationId"/"isSuperAdmin" em users.
--   3. Insere a org default "EduIT" (id=org_eduit) e marca como super-admin
--      quem tem email @eduit.com ou @eduit.com.br (operacao interna).
--   4. Backfill: todos os dados existentes ficam vinculados a org_eduit.
--   5. ALTER COLUMN SET NOT NULL nas ~47 tabelas.
--   6. Ajusta unique constraints que eram globais (Tag.name, Product.sku,
--      Contact.external_id etc) pra serem per-organizacao.
--   7. Cria FKs e indices compostos com organizationId.
--
-- IMPORTANTE: rodar em janela de manutencao curta. Para prod com volume,
-- backfill em loop via WHERE "organizationId" IS NULL LIMIT N se travar.
-- O ideal e esta migration rodar em DB vazio (dev) ou com ate 10M linhas
-- (prod atual EduIT) sem problemas.

-- ============================================================
-- Fase A: tipos e tabelas novas
-- ============================================================

CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

CREATE TABLE "organizations" (
    "id"                    TEXT         NOT NULL,
    "name"                  TEXT         NOT NULL,
    "slug"                  TEXT         NOT NULL,
    "status"                "OrgStatus"  NOT NULL DEFAULT 'ACTIVE',
    "industry"              TEXT,
    "size"                  TEXT,
    "phone"                 TEXT,
    "logoUrl"               TEXT,
    "primaryColor"          TEXT         DEFAULT '#1e3a8a',
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdById"           TEXT,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE INDEX "organizations_status_idx" ON "organizations"("status");

CREATE TABLE "organization_invites" (
    "id"             TEXT         NOT NULL,
    "organizationId" TEXT         NOT NULL,
    "email"          TEXT         NOT NULL,
    "role"           "UserRole"   NOT NULL DEFAULT 'ADMIN',
    "token"          TEXT         NOT NULL,
    "expiresAt"      TIMESTAMP(3) NOT NULL,
    "acceptedAt"     TIMESTAMP(3),
    "acceptedById"   TEXT,
    "createdById"    TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_invites_token_key" ON "organization_invites"("token");
CREATE INDEX "organization_invites_organizationId_idx" ON "organization_invites"("organizationId");
CREATE INDEX "organization_invites_email_idx" ON "organization_invites"("email");
CREATE INDEX "organization_invites_expiresAt_idx" ON "organization_invites"("expiresAt");

ALTER TABLE "organization_invites"
  ADD CONSTRAINT "organization_invites_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Fase B: adicionar colunas em users + cada tabela tenant-scoped
--         (NULLABLE nesta fase — backfill acontece na Fase D)
-- ============================================================

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "organizationId" TEXT,
  ADD COLUMN IF NOT EXISTS "isSuperAdmin"   BOOLEAN NOT NULL DEFAULT false;

-- Tabelas scoped — ADD COLUMN "organizationId" NULLABLE
DO $$
DECLARE
  tbl text;
  scoped_tables text[] := ARRAY[
    'contacts',
    'contact_phone_changes',
    'companies',
    'tags',
    'custom_fields',
    'contact_custom_field_values',
    'deal_custom_field_values',
    'product_custom_field_values',
    'pipelines',
    'stages',
    'deals',
    'deal_products',
    'deal_events',
    'products',
    'activities',
    'notes',
    'conversations',
    'messages',
    'whatsapp_call_events',
    'scheduled_whatsapp_calls',
    'scheduled_messages',
    'automations',
    'automation_steps',
    'automation_logs',
    'automation_contexts',
    'channels',
    'baileys_auth_keys',
    'quick_replies',
    'message_templates',
    'whatsapp_template_configs',
    'distribution_rules',
    'distribution_members',
    'segments',
    'campaigns',
    'campaign_recipients',
    'loss_reasons',
    'api_tokens',
    'mobile_layout_config',
    'user_dashboard_layouts',
    'web_push_subscriptions',
    'agent_schedules',
    'agent_statuses',
    'agent_presence_logs',
    'ai_agent_configs',
    'ai_agent_knowledge_docs',
    'ai_agent_knowledge_chunks',
    'ai_agent_runs',
    'ai_agent_messages'
  ];
BEGIN
  FOREACH tbl IN ARRAY scoped_tables LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS "organizationId" TEXT', tbl);
  END LOOP;
END $$;

-- ============================================================
-- Fase C: criar organizacao "EduIT" e marcar super-admins
-- ============================================================

INSERT INTO "organizations" ("id", "name", "slug", "status", "primaryColor", "onboardingCompletedAt", "createdAt", "updatedAt")
VALUES ('org_eduit', 'EduIT', 'eduit', 'ACTIVE', '#1e3a8a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Qualquer usuario com email da EduIT vira super-admin E fica na org EduIT.
UPDATE "users"
   SET "organizationId" = 'org_eduit',
       "isSuperAdmin"   = true
 WHERE "email" ILIKE '%@eduit.com'
    OR "email" ILIKE '%@eduit.com.br';

-- Demais users existentes (clientes atuais, agentes, etc) tambem ficam
-- na EduIT mas SEM super-admin. Se houver multi-empresa compartilhando
-- o mesmo db atual, o responsavel operacional cria novas orgs depois
-- via /admin/organizations e realoca usuarios manualmente.
UPDATE "users"
   SET "organizationId" = 'org_eduit'
 WHERE "organizationId" IS NULL;

-- ============================================================
-- Fase D: backfill em massa das tabelas scoped
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
    'ai_agent_messages'
  ];
BEGIN
  FOREACH tbl IN ARRAY scoped_tables LOOP
    EXECUTE format('UPDATE %I SET "organizationId" = ''org_eduit'' WHERE "organizationId" IS NULL', tbl);
  END LOOP;
END $$;

-- ============================================================
-- Fase E: SET NOT NULL em todas as scoped tables e users
-- ============================================================

ALTER TABLE "users"
  ALTER COLUMN "organizationId" DROP NOT NULL; -- ja era nullable, idempotente

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
    'ai_agent_messages'
  ];
BEGIN
  FOREACH tbl IN ARRAY scoped_tables LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "organizationId" SET NOT NULL', tbl);
  END LOOP;
END $$;

-- ============================================================
-- Fase F: remover unique constraints antigos (globais)
--         — serao substituidos por compostos (organizationId, X)
-- ============================================================

-- Contact.external_id / whatsapp_bsuid
DROP INDEX IF EXISTS "contacts_external_id_key";
DROP INDEX IF EXISTS "contacts_whatsapp_bsuid_key";

-- Deal.external_id / number
DROP INDEX IF EXISTS "deals_external_id_key";
DROP INDEX IF EXISTS "deals_number_key";

-- Deal.number: remover default autoincrement (nao suporta partition por org)
ALTER TABLE "deals"
  ALTER COLUMN "number" DROP DEFAULT;

-- Nome da sequence criada pelo autoincrement (padrao Postgres): <tabela>_<coluna>_seq
DROP SEQUENCE IF EXISTS "deals_number_seq";

-- Tag.name unique global
DROP INDEX IF EXISTS "tags_name_key";

-- CustomField.name+entity unique global
DROP INDEX IF EXISTS "custom_fields_name_entity_key";

-- Product.sku unique global
DROP INDEX IF EXISTS "products_sku_key";

-- Conversation.externalId unique global
DROP INDEX IF EXISTS "conversations_externalId_key";

-- WhatsAppTemplateConfig.meta_template_id unique global
DROP INDEX IF EXISTS "whatsapp_template_configs_meta_template_id_key";

-- ============================================================
-- Fase G: criar unique constraints per-organization
-- ============================================================

CREATE UNIQUE INDEX "contacts_organizationId_external_id_key"
  ON "contacts"("organizationId", "external_id");

CREATE UNIQUE INDEX "contacts_organizationId_whatsapp_bsuid_key"
  ON "contacts"("organizationId", "whatsapp_bsuid");

CREATE UNIQUE INDEX "deals_organizationId_number_key"
  ON "deals"("organizationId", "number");

CREATE UNIQUE INDEX "deals_organizationId_external_id_key"
  ON "deals"("organizationId", "external_id");

CREATE UNIQUE INDEX "tags_organizationId_name_key"
  ON "tags"("organizationId", "name");

CREATE UNIQUE INDEX "custom_fields_organizationId_name_entity_key"
  ON "custom_fields"("organizationId", "name", "entity");

CREATE UNIQUE INDEX "products_organizationId_sku_key"
  ON "products"("organizationId", "sku");

CREATE UNIQUE INDEX "conversations_organizationId_externalId_key"
  ON "conversations"("organizationId", "externalId");

CREATE UNIQUE INDEX "whatsapp_template_configs_organizationId_meta_template_id_key"
  ON "whatsapp_template_configs"("organizationId", "meta_template_id");

-- mobile_layout_config fica 1-por-org (unique direto em organizationId)
CREATE UNIQUE INDEX "mobile_layout_config_organizationId_key"
  ON "mobile_layout_config"("organizationId");

-- ============================================================
-- Fase H: FK organizationId -> organizations em cada scoped table
-- ============================================================

ALTER TABLE "users"
  ADD CONSTRAINT "users_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

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
    'ai_agent_messages'
  ];
BEGIN
  FOREACH tbl IN ARRAY scoped_tables LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE',
      tbl,
      tbl || '_organizationId_fkey'
    );
  END LOOP;
END $$;

-- ============================================================
-- Fase I: indices compostos de organizationId em tabelas quentes
-- ============================================================
-- Nota: indices simples "(organizationId)" sao criados pra TODAS as tabelas
-- scoped pra acelerar queries basicas e o plano de execucao da RLS. Indices
-- compostos adicionais (ex.: organizationId+status) sao focados nas tabelas
-- consultadas com muita frequencia no app.

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
    'campaign_recipients','loss_reasons','api_tokens',
    'user_dashboard_layouts','web_push_subscriptions','agent_schedules',
    'agent_statuses','agent_presence_logs','ai_agent_configs',
    'ai_agent_knowledge_docs','ai_agent_knowledge_chunks','ai_agent_runs',
    'ai_agent_messages'
  ];
  -- Nota: mobile_layout_config ja ganhou unique index, nao precisa de idx
  -- separado. distribution_members fica com @@unique([ruleId, userId]) +
  -- organizationId idx basico.
BEGIN
  FOREACH tbl IN ARRAY scoped_tables LOOP
    EXECUTE format(
      'CREATE INDEX %I ON %I ("organizationId")',
      tbl || '_organizationId_idx',
      tbl
    );
  END LOOP;
END $$;

-- Indices compostos adicionais em users (super-admin + org membership)
CREATE INDEX IF NOT EXISTS "users_organizationId_idx"       ON "users"("organizationId");
CREATE INDEX IF NOT EXISTS "users_organizationId_role_idx"  ON "users"("organizationId", "role");
CREATE INDEX IF NOT EXISTS "users_organizationId_type_idx"  ON "users"("organizationId", "type");
CREATE INDEX IF NOT EXISTS "users_isSuperAdmin_idx"         ON "users"("isSuperAdmin");

-- Indices compostos extras nas tabelas mais acessadas por
-- organizationId + filtros frequentes (refletem @@index no schema.prisma).

CREATE INDEX IF NOT EXISTS "contacts_organizationId_email_idx"                        ON "contacts"("organizationId", "email");
CREATE INDEX IF NOT EXISTS "contacts_organizationId_phone_idx"                        ON "contacts"("organizationId", "phone");
CREATE INDEX IF NOT EXISTS "contacts_organizationId_whatsappJid_idx"                  ON "contacts"("organizationId", "whatsappJid");
CREATE INDEX IF NOT EXISTS "contacts_organizationId_lifecycleStage_idx"               ON "contacts"("organizationId", "lifecycleStage");
CREATE INDEX IF NOT EXISTS "contacts_organizationId_leadScore_idx"                    ON "contacts"("organizationId", "leadScore");
CREATE INDEX IF NOT EXISTS "contacts_organizationId_companyId_idx"                    ON "contacts"("organizationId", "companyId");
CREATE INDEX IF NOT EXISTS "contacts_organizationId_assignedToId_idx"                 ON "contacts"("organizationId", "assignedToId");
CREATE INDEX IF NOT EXISTS "contacts_organizationId_createdAt_idx"                    ON "contacts"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "contacts_organizationId_updatedAt_idx"                    ON "contacts"("organizationId", "updatedAt");
CREATE INDEX IF NOT EXISTS "contacts_organizationId_assignedToId_lifecycleStage_idx"  ON "contacts"("organizationId", "assignedToId", "lifecycleStage");
CREATE INDEX IF NOT EXISTS "contacts_organizationId_lifecycleStage_createdAt_idx"     ON "contacts"("organizationId", "lifecycleStage", "createdAt");

CREATE INDEX IF NOT EXISTS "deals_organizationId_status_idx"                          ON "deals"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "deals_organizationId_stageId_idx"                         ON "deals"("organizationId", "stageId");
CREATE INDEX IF NOT EXISTS "deals_organizationId_contactId_idx"                       ON "deals"("organizationId", "contactId");
CREATE INDEX IF NOT EXISTS "deals_organizationId_ownerId_idx"                         ON "deals"("organizationId", "ownerId");
CREATE INDEX IF NOT EXISTS "deals_organizationId_createdAt_idx"                       ON "deals"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "deals_organizationId_stageId_status_idx"                  ON "deals"("organizationId", "stageId", "status");
CREATE INDEX IF NOT EXISTS "deals_organizationId_stageId_position_idx"                ON "deals"("organizationId", "stageId", "position");
CREATE INDEX IF NOT EXISTS "deals_organizationId_contactId_status_idx"                ON "deals"("organizationId", "contactId", "status");

CREATE INDEX IF NOT EXISTS "conversations_organizationId_status_idx"                  ON "conversations"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "conversations_organizationId_status_updatedAt_idx"        ON "conversations"("organizationId", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "conversations_organizationId_contactId_idx"               ON "conversations"("organizationId", "contactId");
CREATE INDEX IF NOT EXISTS "conversations_organizationId_assignedToId_idx"            ON "conversations"("organizationId", "assignedToId");
CREATE INDEX IF NOT EXISTS "conversations_organizationId_channelId_idx"               ON "conversations"("organizationId", "channelId");

CREATE INDEX IF NOT EXISTS "messages_organizationId_createdAt_idx"                    ON "messages"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "activities_organizationId_scheduledAt_idx"                ON "activities"("organizationId", "scheduledAt");
CREATE INDEX IF NOT EXISTS "activities_organizationId_userId_idx"                     ON "activities"("organizationId", "userId");
CREATE INDEX IF NOT EXISTS "activities_organizationId_completed_scheduledAt_idx"      ON "activities"("organizationId", "completed", "scheduledAt");

CREATE INDEX IF NOT EXISTS "automations_organizationId_active_idx"                    ON "automations"("organizationId", "active");
CREATE INDEX IF NOT EXISTS "automations_organizationId_active_triggerType_idx"        ON "automations"("organizationId", "active", "triggerType");

CREATE INDEX IF NOT EXISTS "channels_organizationId_status_idx"                       ON "channels"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "channels_organizationId_type_status_idx"                  ON "channels"("organizationId", "type", "status");
CREATE INDEX IF NOT EXISTS "channels_organizationId_provider_status_idx"              ON "channels"("organizationId", "provider", "status");
CREATE INDEX IF NOT EXISTS "channels_phoneNumber_idx"                                 ON "channels"("phoneNumber");

CREATE INDEX IF NOT EXISTS "campaigns_organizationId_status_idx"                      ON "campaigns"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "campaigns_organizationId_type_idx"                        ON "campaigns"("organizationId", "type");
CREATE INDEX IF NOT EXISTS "campaigns_organizationId_scheduledAt_idx"                 ON "campaigns"("organizationId", "scheduledAt");

CREATE INDEX IF NOT EXISTS "pipelines_organizationId_isDefault_idx"                   ON "pipelines"("organizationId", "isDefault");

CREATE INDEX IF NOT EXISTS "products_organizationId_isActive_idx"                     ON "products"("organizationId", "isActive");
CREATE INDEX IF NOT EXISTS "products_organizationId_name_idx"                         ON "products"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "products_organizationId_type_idx"                         ON "products"("organizationId", "type");

CREATE INDEX IF NOT EXISTS "tags_organizationId_name_idx"                             ON "tags"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "custom_fields_organizationId_entity_idx"                  ON "custom_fields"("organizationId", "entity");

CREATE INDEX IF NOT EXISTS "quick_replies_organizationId_category_idx"                ON "quick_replies"("organizationId", "category");
CREATE INDEX IF NOT EXISTS "message_templates_organizationId_status_idx"              ON "message_templates"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "whatsapp_template_configs_organizationId_agent_enabled_idx" ON "whatsapp_template_configs"("organizationId", "agent_enabled");

CREATE INDEX IF NOT EXISTS "distribution_rules_organizationId_isActive_idx"           ON "distribution_rules"("organizationId", "isActive");
CREATE INDEX IF NOT EXISTS "loss_reasons_organizationId_isActive_position_idx"        ON "loss_reasons"("organizationId", "isActive", "position");
CREATE INDEX IF NOT EXISTS "companies_organizationId_name_idx"                        ON "companies"("organizationId", "name");

CREATE INDEX IF NOT EXISTS "agent_statuses_organizationId_status_idx"                 ON "agent_statuses"("organizationId", "status");

CREATE INDEX IF NOT EXISTS "ai_agent_configs_organizationId_active_idx"               ON "ai_agent_configs"("organizationId", "active");

-- Tabela contact_phone_changes mapeia createdAt -> created_at (snake_case via @map em schema.prisma)
CREATE INDEX IF NOT EXISTS "contact_phone_changes_organizationId_source_createdAt_idx"
  ON "contact_phone_changes"("organizationId", "source", "created_at");
