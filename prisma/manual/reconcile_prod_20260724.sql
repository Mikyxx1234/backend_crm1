-- ========================================================================
-- Reconciliação de schema PROD (db_crm) — drift jul/2026 (20260715 → 20260724)
-- Gerado em 24/jul/26 após o outage de `conversations.hasHumanReply`.
--
-- COMO USAR (console Postgres do Easypanel, banco db_crm):
--   1) Rode a SEÇÃO (a) [read-only] p/ ver o que falta (present=false / recorded=false).
--   2) Rode a SEÇÃO (b) [DDL idempotente — sem DROP, seguro reexecutar].
--   3) Rode a SEÇÃO (c) [registra as migrations em _prisma_migrations].
--   4) Rode a SEÇÃO (d) [verificação final — tudo deve ficar present/recorded = true].
--   5) Remova a env var SKIP_PRISMA_MIGRATE do serviço `api` no Easypanel e redeploy.
--
-- OBS enum: se o console rodar tudo em UMA transação e der
--   "ALTER TYPE ... ADD VALUE cannot run inside a transaction block",
--   rode os 3 blocos DO $$ de enum (DEAL_IMPORT, CONVERSATION_BULK_RESOLVE,
--   META_INSTAGRAM_LOGIN) como statements separados. Em prod eles já devem existir.
-- ========================================================================


-- =====================  (a) READ-ONLY — o que falta  =====================

SELECT 'column' AS kind, x.t || '.' || x.c AS object,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = x.t AND column_name = x.c) AS present
FROM (VALUES
  ('conversations','pinnedMessageId'),
  ('conversations','pinnedMessageExpiresAt'),
  ('conversations','number'),
  ('conversations','tabulationId'),
  ('conversations','hasHumanReply'),
  ('departments','requireTabulationOnClose'),
  ('departments','isSupport'),
  ('departments','distributionEnabled'),
  ('activities','departmentId'),
  ('contacts','whatsapp_username'),
  ('contacts','messenger_psid'),
  ('contacts','instagram_igsid'),
  ('companies','cep'),
  ('companies','city'),
  ('companies','state'),
  ('pipelines','lossReasonRequired'),
  ('pipelines','lossReasonAllowOther'),
  ('pipelines','archivedAt'),
  ('roles','sharedInbox'),
  ('roles','mediaAccess'),
  ('messages','triggeredByName'),
  ('message_templates','mediaUrl'),
  ('message_templates','mediaType'),
  ('message_templates','mediaName'),
  ('deals','orgUnitId'),
  ('deals','priceFullSnapshot'),
  ('deals','priceFinalSnapshot'),
  ('discount_quotas','categoryId'),
  ('automations','allowManualRun')
) AS x(t,c)
UNION ALL
SELECT 'table', y.tbl,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = y.tbl)
FROM (VALUES
  ('favorite_messages'),('pinned_messages'),('tabulations'),
  ('department_members'),('role_stage_grants'),('role_field_grants'),
  ('pipeline_loss_reasons'),('discount_quotas'),('quota_consumption_policies'),
  ('deal_quotas'),('quota_movements'),('discount_categories'),
  ('support_tickets'),('support_ticket_messages'),
  ('student_academic_records'),('academic_import_history'),
  ('agent_message_shortcuts')
) AS y(tbl)
UNION ALL
SELECT 'enum_value', z.typ || '.' || z.lbl,
  EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t2 ON t2.oid = e.enumtypid
          WHERE t2.typname = z.typ AND e.enumlabel = z.lbl)
FROM (VALUES
  ('BulkOperationType','DEAL_IMPORT'),
  ('BulkOperationType','CONVERSATION_BULK_RESOLVE'),
  ('ChannelProvider','META_INSTAGRAM_LOGIN')
) AS z(typ,lbl)
ORDER BY present, kind, object;

SELECT v.n AS migration_name,
  EXISTS (SELECT 1 FROM "_prisma_migrations" m
          WHERE m.migration_name = v.n AND m.finished_at IS NOT NULL) AS recorded
FROM (VALUES
  ('20260715120000_add_pinned_message_and_favorites'),
  ('20260715120500_add_conversation_number'),
  ('20260715130000_add_pinned_message_expiry'),
  ('20260715140000_add_pinned_messages_table'),
  ('20260716120000_add_deal_import_bulk_type'),
  ('20260716180000_add_tabulations'),
  ('20260716200000_add_department_members'),
  ('20260716210000_activity_department_assignee'),
  ('20260716220000_conversation_active_unique_per_contact'),
  ('20260717120000_add_contact_whatsapp_username'),
  ('20260717150000_add_company_location_fields'),
  ('20260717160000_add_contact_messenger_instagram_ids'),
  ('20260717170000_add_channel_provider_instagram_login'),
  ('20260717180000_pipeline_loss_reasons'),
  ('20260717200000_pipeline_loss_reason_allow_other'),
  ('20260717210000_roles_absorb_groups'),
  ('20260718170000_add_message_triggered_by_name'),
  ('20260718200000_add_discount_quotas'),
  ('20260718200500_backfill_quota_permissions'),
  ('20260719130000_add_discount_categories'),
  ('20260720150000_pipeline_archived_at'),
  ('20260721180000_add_support_chat'),
  ('20260722160000_add_message_template_media'),
  ('20260722200000_org_distribute_by_department'),
  ('20260722210000_department_distribution_flag'),
  ('20260723120000_add_student_academic_records'),
  ('20260723130000_add_conversation_bulk_resolve_type'),
  ('20260724120000_add_agent_message_shortcuts'),
  ('20260724150000_add_automation_allow_manual_run'),
  ('20260724150000_add_conversation_has_human_reply')
) AS v(n)
ORDER BY recorded, migration_name;


-- =====================  (b) DDL idempotente  =====================
-- FULLY IDEMPOTENT. Sem DROP / sem ALTER que perca dados. Seguro reexecutar.

-- 20260715120000_add_pinned_message_and_favorites -----------------------
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "pinnedMessageId" TEXT;

CREATE TABLE IF NOT EXISTS "favorite_messages" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "favorite_messages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "favorite_messages_userId_messageId_key" ON "favorite_messages"("userId","messageId");
CREATE INDEX IF NOT EXISTS "favorite_messages_organizationId_idx" ON "favorite_messages"("organizationId");
CREATE INDEX IF NOT EXISTS "favorite_messages_messageId_idx" ON "favorite_messages"("messageId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='favorite_messages_organizationId_fkey') THEN
    ALTER TABLE "favorite_messages" ADD CONSTRAINT "favorite_messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='favorite_messages_userId_fkey') THEN
    ALTER TABLE "favorite_messages" ADD CONSTRAINT "favorite_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='favorite_messages_messageId_fkey') THEN
    ALTER TABLE "favorite_messages" ADD CONSTRAINT "favorite_messages_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
END $$;

-- 20260715120500_add_conversation_number --------------------------------
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "number" INTEGER;
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", id) AS rn
  FROM "conversations" WHERE "number" IS NULL
)
UPDATE "conversations" c SET "number" = n.rn FROM numbered n WHERE c.id = n.id;
ALTER TABLE "conversations" ALTER COLUMN "number" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_organizationId_number_key" ON "conversations"("organizationId","number");

-- 20260715130000_add_pinned_message_expiry ------------------------------
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "pinnedMessageExpiresAt" TIMESTAMP(3);

-- 20260715140000_add_pinned_messages_table ------------------------------
CREATE TABLE IF NOT EXISTS "pinned_messages" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pinned_messages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "pinned_messages_conversationId_messageId_key" ON "pinned_messages"("conversationId","messageId");
CREATE INDEX IF NOT EXISTS "pinned_messages_organizationId_idx" ON "pinned_messages"("organizationId");
CREATE INDEX IF NOT EXISTS "pinned_messages_conversationId_createdAt_idx" ON "pinned_messages"("conversationId","createdAt");
CREATE INDEX IF NOT EXISTS "pinned_messages_messageId_idx" ON "pinned_messages"("messageId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pinned_messages_organizationId_fkey') THEN
    ALTER TABLE "pinned_messages" ADD CONSTRAINT "pinned_messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pinned_messages_conversationId_fkey') THEN
    ALTER TABLE "pinned_messages" ADD CONSTRAINT "pinned_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pinned_messages_messageId_fkey') THEN
    ALTER TABLE "pinned_messages" ADD CONSTRAINT "pinned_messages_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
END $$;
INSERT INTO "pinned_messages" ("id","organizationId","conversationId","messageId","expiresAt","createdAt")
SELECT gen_random_uuid()::text, c."organizationId", c."id", c."pinnedMessageId", c."pinnedMessageExpiresAt", CURRENT_TIMESTAMP
FROM "conversations" c
WHERE c."pinnedMessageId" IS NOT NULL
ON CONFLICT ("conversationId","messageId") DO NOTHING;

-- 20260716120000_add_deal_import_bulk_type ------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
    WHERE t.typname='BulkOperationType' AND e.enumlabel='DEAL_IMPORT') THEN
    ALTER TYPE "BulkOperationType" ADD VALUE 'DEAL_IMPORT';
  END IF;
END $$;

-- 20260716180000_add_tabulations ----------------------------------------
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "requireTabulationOnClose" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS "tabulations" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "color" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tabulations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "tabulations_organizationId_idx" ON "tabulations"("organizationId");
CREATE INDEX IF NOT EXISTS "tabulations_organizationId_departmentId_idx" ON "tabulations"("organizationId","departmentId");
CREATE INDEX IF NOT EXISTS "tabulations_organizationId_departmentId_parentId_idx" ON "tabulations"("organizationId","departmentId","parentId");
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "tabulationId" TEXT;
CREATE INDEX IF NOT EXISTS "conversations_organizationId_tabulationId_idx" ON "conversations"("organizationId","tabulationId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tabulations_organizationId_fkey') THEN
    ALTER TABLE "tabulations" ADD CONSTRAINT "tabulations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tabulations_departmentId_fkey') THEN
    ALTER TABLE "tabulations" ADD CONSTRAINT "tabulations_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tabulations_parentId_fkey') THEN
    ALTER TABLE "tabulations" ADD CONSTRAINT "tabulations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "tabulations"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='conversations_tabulationId_fkey') THEN
    ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tabulationId_fkey" FOREIGN KEY ("tabulationId") REFERENCES "tabulations"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
END $$;

-- 20260716200000_add_department_members ---------------------------------
CREATE TABLE IF NOT EXISTS "department_members" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "department_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "department_members_departmentId_userId_key" ON "department_members"("departmentId","userId");
CREATE INDEX IF NOT EXISTS "department_members_organizationId_idx" ON "department_members"("organizationId");
CREATE INDEX IF NOT EXISTS "department_members_userId_idx" ON "department_members"("userId");
CREATE INDEX IF NOT EXISTS "department_members_departmentId_idx" ON "department_members"("departmentId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='department_members_organizationId_fkey') THEN
    ALTER TABLE "department_members" ADD CONSTRAINT "department_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='department_members_departmentId_fkey') THEN
    ALTER TABLE "department_members" ADD CONSTRAINT "department_members_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='department_members_userId_fkey') THEN
    ALTER TABLE "department_members" ADD CONSTRAINT "department_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
END $$;

-- 20260716210000_activity_department_assignee ---------------------------
ALTER TABLE "activities" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "departmentId" TEXT;
CREATE INDEX IF NOT EXISTS "activities_organizationId_departmentId_idx" ON "activities"("organizationId","departmentId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='activities_departmentId_fkey') THEN
    ALTER TABLE "activities" ADD CONSTRAINT "activities_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
END $$;

-- 20260716220000_conversation_active_unique_per_contact -----------------
-- Fecha (status=RESOLVED) tickets ativos DUPLICADOS, mantendo o mais ANTIGO.
-- Nunca apaga linhas. Necessário p/ o índice único parcial abaixo.
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "organizationId","contactId","channel"
    ORDER BY "createdAt" ASC, "id" ASC) AS rn
  FROM "conversations" WHERE "status" <> 'RESOLVED'
)
UPDATE "conversations" AS c
SET "status" = 'RESOLVED', "closedAt" = COALESCE(c."closedAt", NOW())
FROM ranked WHERE c."id" = ranked."id" AND ranked.rn > 1;
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_active_contact_channel"
  ON "conversations" ("organizationId","contactId","channel")
  WHERE "status" <> 'RESOLVED';

-- 20260717120000_add_contact_whatsapp_username --------------------------
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "whatsapp_username" TEXT;

-- 20260717150000_add_company_location_fields ----------------------------
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "cep" TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "state" TEXT;
CREATE INDEX IF NOT EXISTS "companies_organizationId_state_idx" ON "companies"("organizationId","state");
CREATE INDEX IF NOT EXISTS "companies_organizationId_city_idx" ON "companies"("organizationId","city");

-- 20260717160000_add_contact_messenger_instagram_ids --------------------
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "messenger_psid" TEXT;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "instagram_igsid" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_organizationId_messenger_psid_key" ON "contacts" ("organizationId","messenger_psid");
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_organizationId_instagram_igsid_key" ON "contacts" ("organizationId","instagram_igsid");

-- 20260717170000_add_channel_provider_instagram_login -------------------
ALTER TYPE "ChannelProvider" ADD VALUE IF NOT EXISTS 'META_INSTAGRAM_LOGIN';

-- 20260717180000_pipeline_loss_reasons ----------------------------------
ALTER TABLE "pipelines" ADD COLUMN IF NOT EXISTS "lossReasonRequired" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS "pipeline_loss_reasons" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "pipelineId" TEXT NOT NULL,
  "lossReasonId" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pipeline_loss_reasons_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_loss_reasons_pipelineId_lossReasonId_key" ON "pipeline_loss_reasons"("pipelineId","lossReasonId");
CREATE INDEX IF NOT EXISTS "pipeline_loss_reasons_organizationId_idx" ON "pipeline_loss_reasons"("organizationId");
CREATE INDEX IF NOT EXISTS "pipeline_loss_reasons_pipelineId_position_idx" ON "pipeline_loss_reasons"("pipelineId","position");
CREATE INDEX IF NOT EXISTS "pipeline_loss_reasons_lossReasonId_idx" ON "pipeline_loss_reasons"("lossReasonId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pipeline_loss_reasons_organizationId_fkey') THEN
    ALTER TABLE "pipeline_loss_reasons" ADD CONSTRAINT "pipeline_loss_reasons_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pipeline_loss_reasons_pipelineId_fkey') THEN
    ALTER TABLE "pipeline_loss_reasons" ADD CONSTRAINT "pipeline_loss_reasons_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pipeline_loss_reasons_lossReasonId_fkey') THEN
    ALTER TABLE "pipeline_loss_reasons" ADD CONSTRAINT "pipeline_loss_reasons_lossReasonId_fkey" FOREIGN KEY ("lossReasonId") REFERENCES "loss_reasons"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
END $$;
INSERT INTO "pipeline_loss_reasons" ("id","organizationId","pipelineId","lossReasonId","position","createdAt")
SELECT md5(random()::text || clock_timestamp()::text || p.id || lr.id), p."organizationId", p.id, lr.id, lr."position", CURRENT_TIMESTAMP
FROM "pipelines" p
INNER JOIN "loss_reasons" lr ON lr."organizationId" = p."organizationId" AND lr."isActive" = true
ON CONFLICT ("pipelineId","lossReasonId") DO NOTHING;
UPDATE "pipelines" p SET "lossReasonRequired" = true
WHERE EXISTS (SELECT 1 FROM "organization_settings" os
  WHERE os."organizationId" = p."organizationId"
    AND os."key" = 'deals.loss_reason_required' AND os."value" = 'true');

-- 20260717200000_pipeline_loss_reason_allow_other -----------------------
ALTER TABLE "pipelines" ADD COLUMN IF NOT EXISTS "lossReasonAllowOther" BOOLEAN NOT NULL DEFAULT true;
UPDATE "pipelines" p SET "lossReasonAllowOther" = false
WHERE EXISTS (SELECT 1 FROM "organization_settings" os
  WHERE os."organizationId" = p."organizationId"
    AND os."key" = 'deals.loss_reason_allow_other' AND os."value" = 'false');

-- 20260717210000_roles_absorb_groups (só aditivo; DROPs de grupos omitidos)
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "sharedInbox" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "mediaAccess" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS "role_stage_grants" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "canView" BOOLEAN NOT NULL DEFAULT true,
  "canEdit" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "role_stage_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "role_stage_grants_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "role_stage_grants_roleId_stageId_key" ON "role_stage_grants" ("roleId","stageId");
CREATE INDEX IF NOT EXISTS "role_stage_grants_organizationId_idx" ON "role_stage_grants" ("organizationId");
CREATE INDEX IF NOT EXISTS "role_stage_grants_roleId_idx" ON "role_stage_grants" ("roleId");
CREATE TABLE IF NOT EXISTS "role_field_grants" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "fieldKey" TEXT NOT NULL,
  "canView" BOOLEAN NOT NULL DEFAULT true,
  "canEdit" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "role_field_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "role_field_grants_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "role_field_grants_roleId_entity_fieldKey_key" ON "role_field_grants" ("roleId","entity","fieldKey");
CREATE INDEX IF NOT EXISTS "role_field_grants_organizationId_idx" ON "role_field_grants" ("organizationId");
CREATE INDEX IF NOT EXISTS "role_field_grants_roleId_idx" ON "role_field_grants" ("roleId");

-- 20260718170000_add_message_triggered_by_name --------------------------
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "triggeredByName" TEXT;

-- 20260718200000_add_discount_quotas ------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='DiscountType') THEN CREATE TYPE "DiscountType" AS ENUM ('PERCENT','FIXED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='QuotaCalcMode') THEN CREATE TYPE "QuotaCalcMode" AS ENUM ('CASCADE','SUM_SIMPLE'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='QuotaConsumeMoment') THEN CREATE TYPE "QuotaConsumeMoment" AS ENUM ('ON_WIN','ON_RESERVE'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='DealQuotaStatus') THEN CREATE TYPE "DealQuotaStatus" AS ENUM ('SELECTED','RESERVED','CONSUMED','RETURNED','EXPIRED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='QuotaMovementType') THEN CREATE TYPE "QuotaMovementType" AS ENUM ('RESERVE','CONSUME','RETURN','EXPIRE','MANUAL_ADJUST'); END IF;
END $$;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "orgUnitId" TEXT;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "priceFullSnapshot" DECIMAL(12,2);
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "priceFinalSnapshot" DECIMAL(12,2);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='deals_orgUnitId_fkey') THEN
    ALTER TABLE "deals" ADD CONSTRAINT "deals_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
END $$;
CREATE INDEX IF NOT EXISTS "deals_organizationId_orgUnitId_idx" ON "deals" ("organizationId","orgUnitId");
CREATE TABLE IF NOT EXISTS "discount_quotas" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "discountType" "DiscountType" NOT NULL DEFAULT 'PERCENT',
  "discountValue" DECIMAL(12,2) NOT NULL,
  "productId" TEXT,
  "orgUnitId" TEXT,
  "qtyTotal" INT,
  "qtyConsumed" INT NOT NULL DEFAULT 0,
  "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validTo" TIMESTAMP(3),
  "exclusionGroup" TEXT,
  "maxStacks" INT NOT NULL DEFAULT 1,
  "calcMode" "QuotaCalcMode" NOT NULL DEFAULT 'CASCADE',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "discount_quotas_qty_check" CHECK ("qtyTotal" IS NULL OR "qtyConsumed" <= "qtyTotal"),
  CONSTRAINT "discount_quotas_value_check" CHECK ("discountValue" > 0)
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='discount_quotas_organizationId_fkey') THEN
    ALTER TABLE "discount_quotas" ADD CONSTRAINT "discount_quotas_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='discount_quotas_productId_fkey') THEN
    ALTER TABLE "discount_quotas" ADD CONSTRAINT "discount_quotas_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='discount_quotas_orgUnitId_fkey') THEN
    ALTER TABLE "discount_quotas" ADD CONSTRAINT "discount_quotas_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
END $$;
CREATE INDEX IF NOT EXISTS "discount_quotas_organizationId_active_idx" ON "discount_quotas" ("organizationId","active");
CREATE INDEX IF NOT EXISTS "discount_quotas_scope_idx" ON "discount_quotas" ("organizationId","productId","orgUnitId","active");
CREATE INDEX IF NOT EXISTS "discount_quotas_productId_idx" ON "discount_quotas" ("productId");
CREATE INDEX IF NOT EXISTS "discount_quotas_orgUnitId_idx" ON "discount_quotas" ("orgUnitId");
CREATE TABLE IF NOT EXISTS "quota_consumption_policies" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "quotaId" TEXT,
  "consumeMoment" "QuotaConsumeMoment" NOT NULL DEFAULT 'ON_WIN',
  "reserveThreshold" INT,
  "reserveTtlHours" INT NOT NULL DEFAULT 48,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='quota_consumption_policies_organizationId_fkey') THEN
    ALTER TABLE "quota_consumption_policies" ADD CONSTRAINT "quota_consumption_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='quota_consumption_policies_quotaId_fkey') THEN
    ALTER TABLE "quota_consumption_policies" ADD CONSTRAINT "quota_consumption_policies_quotaId_fkey" FOREIGN KEY ("quotaId") REFERENCES "discount_quotas"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "quota_consumption_policies_quotaId_key" ON "quota_consumption_policies" ("quotaId");
CREATE INDEX IF NOT EXISTS "quota_consumption_policies_organizationId_idx" ON "quota_consumption_policies" ("organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS "quota_consumption_policies_default_per_org" ON "quota_consumption_policies" ("organizationId") WHERE "quotaId" IS NULL AND "active";
CREATE TABLE IF NOT EXISTS "deal_quotas" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "dealId" TEXT NOT NULL,
  "quotaId" TEXT NOT NULL,
  "status" "DealQuotaStatus" NOT NULL DEFAULT 'SELECTED',
  "valueSnapshot" DECIMAL(12,2) NOT NULL,
  "typeSnapshot" "DiscountType" NOT NULL,
  "reservedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deal_quotas_dealId_quotaId_key" UNIQUE ("dealId","quotaId")
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='deal_quotas_organizationId_fkey') THEN
    ALTER TABLE "deal_quotas" ADD CONSTRAINT "deal_quotas_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='deal_quotas_dealId_fkey') THEN
    ALTER TABLE "deal_quotas" ADD CONSTRAINT "deal_quotas_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='deal_quotas_quotaId_fkey') THEN
    ALTER TABLE "deal_quotas" ADD CONSTRAINT "deal_quotas_quotaId_fkey" FOREIGN KEY ("quotaId") REFERENCES "discount_quotas"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF;
END $$;
CREATE INDEX IF NOT EXISTS "deal_quotas_organizationId_idx" ON "deal_quotas" ("organizationId");
CREATE INDEX IF NOT EXISTS "deal_quotas_dealId_idx" ON "deal_quotas" ("dealId");
CREATE INDEX IF NOT EXISTS "deal_quotas_quotaId_idx" ON "deal_quotas" ("quotaId");
CREATE INDEX IF NOT EXISTS "deal_quotas_status_idx" ON "deal_quotas" ("status");
CREATE TABLE IF NOT EXISTS "quota_movements" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "quotaId" TEXT NOT NULL,
  "dealId" TEXT,
  "type" "QuotaMovementType" NOT NULL,
  "qty" INT NOT NULL DEFAULT 1,
  "userId" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='quota_movements_organizationId_fkey') THEN
    ALTER TABLE "quota_movements" ADD CONSTRAINT "quota_movements_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='quota_movements_quotaId_fkey') THEN
    ALTER TABLE "quota_movements" ADD CONSTRAINT "quota_movements_quotaId_fkey" FOREIGN KEY ("quotaId") REFERENCES "discount_quotas"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
END $$;
CREATE INDEX IF NOT EXISTS "quota_movements_organizationId_idx" ON "quota_movements" ("organizationId");
CREATE INDEX IF NOT EXISTS "quota_movements_quotaId_createdAt_idx" ON "quota_movements" ("quotaId","createdAt");
CREATE INDEX IF NOT EXISTS "quota_movements_dealId_idx" ON "quota_movements" ("dealId");

-- 20260718200500_backfill_quota_permissions -----------------------------
UPDATE "roles" SET "permissions" = ARRAY(SELECT DISTINCT k FROM UNNEST("permissions" || ARRAY['quota:view','quota:manage']::TEXT[]) AS k), "updatedAt" = NOW() WHERE "systemPreset" = 'MANAGER';
UPDATE "roles" SET "permissions" = ARRAY(SELECT DISTINCT k FROM UNNEST("permissions" || ARRAY['quota:view']::TEXT[]) AS k), "updatedAt" = NOW() WHERE "systemPreset" = 'MEMBER';

-- 20260719130000_add_discount_categories --------------------------------
CREATE TABLE IF NOT EXISTS "discount_categories" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "discountType" "DiscountType" NOT NULL DEFAULT 'PERCENT',
  "discountValue" DECIMAL(12,2) NOT NULL,
  "productId" TEXT,
  "exclusionGroup" TEXT,
  "maxStacks" INT NOT NULL DEFAULT 1,
  "calcMode" "QuotaCalcMode" NOT NULL DEFAULT 'CASCADE',
  "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validTo" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "discount_categories_value_check" CHECK ("discountValue" > 0)
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='discount_categories_organizationId_fkey') THEN
    ALTER TABLE "discount_categories" ADD CONSTRAINT "discount_categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='discount_categories_productId_fkey') THEN
    ALTER TABLE "discount_categories" ADD CONSTRAINT "discount_categories_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
END $$;
CREATE INDEX IF NOT EXISTS "discount_categories_organizationId_active_idx" ON "discount_categories" ("organizationId","active");
CREATE INDEX IF NOT EXISTS "discount_categories_productId_idx" ON "discount_categories" ("productId");
ALTER TABLE "discount_quotas" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='discount_quotas_categoryId_fkey') THEN
    ALTER TABLE "discount_quotas" ADD CONSTRAINT "discount_quotas_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "discount_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
END $$;
CREATE INDEX IF NOT EXISTS "discount_quotas_categoryId_idx" ON "discount_quotas" ("categoryId");

-- 20260720150000_pipeline_archived_at -----------------------------------
ALTER TABLE "pipelines" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "pipelines_organizationId_archivedAt_idx" ON "pipelines"("organizationId","archivedAt");

-- 20260721180000_add_support_chat ---------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='SupportTicketStatus') THEN CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN','PENDING','RESOLVED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='SupportMessageAuthorType') THEN CREATE TYPE "SupportMessageAuthorType" AS ENUM ('requester','agent','system'); END IF;
END $$;
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "isSupport" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'PENDING',
  "requesterId" TEXT NOT NULL,
  "assignedToId" TEXT,
  "departmentId" TEXT,
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requesterUnread" INTEGER NOT NULL DEFAULT 0,
  "agentUnread" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "support_tickets_organizationId_status_idx" ON "support_tickets"("organizationId","status");
CREATE INDEX IF NOT EXISTS "support_tickets_organizationId_assignedToId_idx" ON "support_tickets"("organizationId","assignedToId");
CREATE INDEX IF NOT EXISTS "support_tickets_organizationId_requesterId_idx" ON "support_tickets"("organizationId","requesterId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='support_tickets_organizationId_fkey') THEN
    ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='support_tickets_requesterId_fkey') THEN
    ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='support_tickets_assignedToId_fkey') THEN
    ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='support_tickets_departmentId_fkey') THEN
    ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
END $$;
CREATE TABLE IF NOT EXISTS "support_ticket_messages" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "authorId" TEXT,
  "authorType" "SupportMessageAuthorType" NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "support_ticket_messages_ticketId_idx" ON "support_ticket_messages"("ticketId");
CREATE INDEX IF NOT EXISTS "support_ticket_messages_organizationId_idx" ON "support_ticket_messages"("organizationId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='support_ticket_messages_organizationId_fkey') THEN
    ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='support_ticket_messages_ticketId_fkey') THEN
    ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='support_ticket_messages_authorId_fkey') THEN
    ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
END $$;

-- 20260722160000_add_message_template_media -----------------------------
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "mediaUrl" TEXT;
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "mediaType" TEXT;
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "mediaName" TEXT;

-- 20260722200000_org_distribute_by_department + 20260722210000_department_distribution_flag
-- Efeito líquido: departments.distributionEnabled. A coluna org-level
-- "distributeByDepartment" NÃO é readicionada nem dropada (DROP omitido pela
-- regra não-destrutiva; coluna sobrando é inofensiva — o schema atual não a usa).
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "distributionEnabled" BOOLEAN NOT NULL DEFAULT false;

-- 20260723120000_add_student_academic_records ---------------------------
CREATE TABLE IF NOT EXISTS "student_academic_records" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "cpf" TEXT, "rgm" TEXT, "nome" TEXT NOT NULL, "curso" TEXT, "serie" TEXT,
  "polo" TEXT, "ciclo" TEXT, "instituicao" TEXT, "situacao" TEXT,
  "tipo_matricula" TEXT, "data_matricula" TIMESTAMP(3), "data_nascimento" TEXT,
  "email" TEXT, "email_academico" TEXT, "phone" TEXT, "raw" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_academic_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "student_academic_records_organization_id_cpf_idx" ON "student_academic_records"("organization_id","cpf");
CREATE INDEX IF NOT EXISTS "student_academic_records_organization_id_phone_idx" ON "student_academic_records"("organization_id","phone");
CREATE INDEX IF NOT EXISTS "student_academic_records_organization_id_email_idx" ON "student_academic_records"("organization_id","email");
CREATE TABLE IF NOT EXISTS "academic_import_history" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "report_type" TEXT NOT NULL DEFAULT 'matriculados',
  "file_name" TEXT,
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "uploaded_by_id" TEXT,
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "academic_import_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "academic_import_history_organization_id_imported_at_idx" ON "academic_import_history"("organization_id","imported_at");

-- 20260723130000_add_conversation_bulk_resolve_type ---------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
    WHERE t.typname='BulkOperationType' AND e.enumlabel='CONVERSATION_BULK_RESOLVE') THEN
    ALTER TYPE "BulkOperationType" ADD VALUE 'CONVERSATION_BULK_RESOLVE';
  END IF;
END $$;

-- 20260724120000_add_agent_message_shortcuts ----------------------------
CREATE TABLE IF NOT EXISTS "agent_message_shortcuts" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemKind" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "favorite" BOOLEAN NOT NULL DEFAULT false,
  "useCount" INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_message_shortcuts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "agent_message_shortcuts_userId_itemKind_itemId_key" ON "agent_message_shortcuts"("userId","itemKind","itemId");
CREATE INDEX IF NOT EXISTS "agent_message_shortcuts_organizationId_idx" ON "agent_message_shortcuts"("organizationId");
CREATE INDEX IF NOT EXISTS "agent_message_shortcuts_userId_idx" ON "agent_message_shortcuts"("userId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agent_message_shortcuts_organizationId_fkey') THEN
    ALTER TABLE "agent_message_shortcuts" ADD CONSTRAINT "agent_message_shortcuts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agent_message_shortcuts_userId_fkey') THEN
    ALTER TABLE "agent_message_shortcuts" ADD CONSTRAINT "agent_message_shortcuts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
END $$;

-- 20260724150000_add_automation_allow_manual_run ------------------------
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "allowManualRun" BOOLEAN NOT NULL DEFAULT false;

-- 20260724150000_add_conversation_has_human_reply -----------------------
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "hasHumanReply" BOOLEAN NOT NULL DEFAULT false;
UPDATE "conversations" c SET "hasHumanReply" = true
WHERE EXISTS (SELECT 1 FROM "messages" m
  WHERE m."conversationId" = c."id" AND m."direction" = 'out' AND m."authorType" = 'human');
CREATE INDEX IF NOT EXISTS "conversations_organizationId_status_assignedToId_hasHumanRep_idx"
  ON "conversations" ("organizationId","status","assignedToId","hasHumanReply");


-- =====================  (c) Registrar em _prisma_migrations  =====================
-- Rode DEPOIS da seção (b). Guardado (WHERE NOT EXISTS) — seguro reexecutar.
-- Checksums = sha256 LF-normalizado de cada migration.sql (a imagem prod é Linux/LF).
-- Se um futuro `migrate deploy` reclamar de checksum, use na máquina com CLI:
--   prisma migrate resolve --applied <migration_name>

INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, v.checksum, now(), v.name, NULL, NULL, now(), 1
FROM (VALUES
  ('4388241fe43c424b49fb0b28e7bb27e97f921de21e13d74fe535b929ae9b9c7c','20260715120000_add_pinned_message_and_favorites'),
  ('25b17e90cd055781d67dd7a035a1b478c8ecec62c3927e7640a00961713a4ee8','20260715120500_add_conversation_number'),
  ('738384571da9408b8948c0a6adc79c2c55b2cdea8f778024153ba81e2f975d38','20260715130000_add_pinned_message_expiry'),
  ('72160c006e4b44414e2c17c609abf342314b6f0b1794582b5cc7f7e87c84fd62','20260715140000_add_pinned_messages_table'),
  ('8bc25e5b191c2ec22e3c62feccae15af18eed4ced1586a4c1aebb7e23ae82c64','20260716120000_add_deal_import_bulk_type'),
  ('a5bb19831f323339138aad18cfed28d022244b2404f1ba3a1746724d111761af','20260716180000_add_tabulations'),
  ('0660a54b03604da64acf92ab8a79cdb78a5a23551f9cdc9b5fbccee0fb3d293f','20260716200000_add_department_members'),
  ('ab5ba6a0a110c49f201dbdab65af0c0ea2cb85ad2f5d296f869b4005ee0a35c5','20260716210000_activity_department_assignee'),
  ('f8ecd9ecdc951ecfb4b60e5ba21a053c333222e6d6a99e62f6dfdb9f8755a75d','20260716220000_conversation_active_unique_per_contact'),
  ('640742a12569a0113c919f47801af7edafe3a5959f6e7f2dba8adef17db827d8','20260717120000_add_contact_whatsapp_username'),
  ('3d5c8f3ad3fb56d20d88deaa14587ad3d483b2b95f0fe7b1a5aea1058e1a7d30','20260717150000_add_company_location_fields'),
  ('f3a3792f7d38439dc7661de4471438bae23acc011d98388b477fb11ffdaa4146','20260717160000_add_contact_messenger_instagram_ids'),
  ('baca0de2ec34243f39dabb437d5fd14b9ec9fa188f691e680e38d14320b28eda','20260717170000_add_channel_provider_instagram_login'),
  ('0a264a59aedaad59fee56fee7e70386d2a446881398915dd40846d3e5474bdf3','20260717180000_pipeline_loss_reasons'),
  ('ffe357c51871259a233af782634fb625b5594068176e0f13e0ee5ef89ee8ea4f','20260717200000_pipeline_loss_reason_allow_other'),
  ('cea165d4563b6fa7fcef1307649f1358d83c3b3d6fa372ce6d1fdf63b0bae3e5','20260717210000_roles_absorb_groups'),
  ('75b472cda2211da0c75f1da01ecb3b9bed1909026d043a42fff543732232f486','20260718170000_add_message_triggered_by_name'),
  ('d16992905df8db61ab1404a539ab7f2a9b24e007cd07d7fa19903f3aef0e9be7','20260718200000_add_discount_quotas'),
  ('4fb202f11b78d912f25e41c58031ad0cb2e0b5bea0721cc6632ecfc938b54a23','20260718200500_backfill_quota_permissions'),
  ('e66b12f4b6d3f8ce2faf670e90361280fbc873ed275a43e0b7d2b88664d115a7','20260719130000_add_discount_categories'),
  ('926c2d4146422cec1090b57a819888f4a9dd5e7ede97b4896760143473f7032a','20260720150000_pipeline_archived_at'),
  ('3d6af60e078b7770859c7dc48dfa810e11136bc6343dd7e4808e02ebd7f01098','20260721180000_add_support_chat'),
  ('d53f521e25e4b53fa77f3e37fd1a8568254b69cc1ac5327c662ffa75075ec31e','20260722160000_add_message_template_media'),
  ('e0f5bf1a6423cc2999758577065411d6bd926d654c743a0c483204558cd0a7f2','20260722200000_org_distribute_by_department'),
  ('98ecdfd3b5f881fe8254a9a2d6776c74ff4f1dc40e15b544460cddb22b4cf2a2','20260722210000_department_distribution_flag'),
  ('9f80f9eff5cde34f871463350158f75e8db1124054b1745adc5b17f9d47db42e','20260723120000_add_student_academic_records'),
  ('cd8fe356e58c8f8fa3c519479d09f522f19ebeb4eef60540b4012def4997b24e','20260723130000_add_conversation_bulk_resolve_type'),
  ('aaaaffc57a133335501c31a496296585c02c2ab28548062862132f5fffbd5133','20260724120000_add_agent_message_shortcuts'),
  ('588fad00eddaa7e7b704483a5d30aa746a1c1b6406ba67eb2e7abf6db806d496','20260724150000_add_automation_allow_manual_run'),
  ('2d404dd4d0dd1246d72c832c11f19feaf730b117b01e01116caf78b79f7dfe1a','20260724150000_add_conversation_has_human_reply')
) AS v(checksum, name)
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations" m
  WHERE m.migration_name = v.name AND m.finished_at IS NOT NULL
);


-- =====================  (d) Verificação final  =====================
-- Reexecute as 2 queries da seção (a): tudo deve ficar present=true / recorded=true.
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name='conversations' AND column_name='hasHumanReply') AS has_human_reply_col,
  (SELECT count(*) FROM "_prisma_migrations"
     WHERE migration_name LIKE '202607%' AND finished_at IS NOT NULL) AS recorded_202607_migrations;
