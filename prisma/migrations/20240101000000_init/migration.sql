-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'UNPAID', 'CANCELED');

-- CreateEnum
CREATE TYPE "DataRequestType" AS ENUM ('EXPORT', 'ERASE');

-- CreateEnum
CREATE TYPE "DataRequestStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'MEMBER');

-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('HUMAN', 'AI');

-- CreateEnum
CREATE TYPE "LifecycleStage" AS ENUM ('SUBSCRIBER', 'LEAD', 'MQL', 'SQL', 'OPPORTUNITY', 'CUSTOMER', 'EVANGELIST', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactPhoneChangeSource" AS ENUM ('WHATSAPP_SYSTEM', 'MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'SELECT', 'MULTI_SELECT', 'BOOLEAN', 'URL', 'EMAIL', 'PHONE');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'TASK', 'NOTE', 'WHATSAPP', 'OTHER');

-- CreateEnum
CREATE TYPE "MessageAuthorType" AS ENUM ('human', 'bot', 'system');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'RESOLVED', 'PENDING', 'SNOOZED');

-- CreateEnum
CREATE TYPE "WhatsappCallConsentStatus" AS ENUM ('NONE', 'REQUESTED', 'GRANTED', 'EXPIRED', 'DENIED');

-- CreateEnum
CREATE TYPE "WhatsappCallConsentType" AS ENUM ('TEMPORARY', 'PERMANENT');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'EMAIL', 'WEBCHAT');

-- CreateEnum
CREATE TYPE "ChannelProvider" AS ENUM ('META_CLOUD_API', 'BAILEYS_MD');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'CONNECTING', 'QR_READY', 'FAILED');

-- CreateEnum
CREATE TYPE "WhatsappFlowStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "FlowFieldMappingTargetKind" AS ENUM ('CONTACT_NATIVE', 'CUSTOM_FIELD');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DistributionMode" AS ENUM ('ROUND_ROBIN', 'RULE_BASED', 'MANUAL');

-- CreateEnum
CREATE TYPE "AutomationCtxStatus" AS ENUM ('RUNNING', 'PAUSED', 'COMPLETED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "ScheduledWhatsappCallStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgentOnlineStatus" AS ENUM ('ONLINE', 'OFFLINE', 'AWAY');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PROCESSING', 'SENDING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('TEMPLATE', 'TEXT', 'AUTOMATION');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "AIAgentArchetype" AS ENUM ('SDR', 'ATENDIMENTO', 'VENDEDOR', 'SUPORTE');

-- CreateEnum
CREATE TYPE "AIAgentAutonomy" AS ENUM ('AUTONOMOUS', 'DRAFT');

-- CreateEnum
CREATE TYPE "AIAgentKnowledgeStatus" AS ENUM ('PENDING', 'INDEXING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "AIAgentRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'HANDOFF');

-- CreateEnum
CREATE TYPE "ScheduledMessageStatus" AS ENUM ('PENDING', 'SENT', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "industry" TEXT,
    "size" TEXT,
    "phone" TEXT,
    "logoUrl" TEXT,
    "primaryColor" TEXT DEFAULT '#1e3a8a',
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_feature_flags" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "value" JSONB,
    "setById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "limitsOverride" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meter" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceId" TEXT,
    "reportedAt" TIMESTAMP(3),
    "reportIdempKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_invites" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'ADMIN',
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "hashedPassword" TEXT,
    "type" "UserType" NOT NULL DEFAULT 'HUMAN',
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "avatarUrl" TEXT,
    "phone" TEXT,
    "signature" TEXT,
    "closingMessage" TEXT,
    "chatTheme" TEXT NOT NULL DEFAULT 'azul',
    "organizationId" TEXT,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "mfaEnabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "erasedAt" TIMESTAMP(3),
    "isErased" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_mfa_backup_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_mfa_backup_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "actorIsSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedById" TEXT,
    "type" "DataRequestType" NOT NULL,
    "status" "DataRequestStatus" NOT NULL DEFAULT 'PENDING',
    "downloadKey" TEXT,
    "downloadSize" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "contentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_dashboard_layouts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Padrão',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "preset" TEXT NOT NULL DEFAULT 'custom',
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_dashboard_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_layout_configs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "context" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_layout_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "systemPreset" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role_assignments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "external_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "leadScore" INTEGER NOT NULL DEFAULT 0,
    "lifecycleStage" "LifecycleStage" NOT NULL DEFAULT 'SUBSCRIBER',
    "source" TEXT,
    "ad_source_id" TEXT,
    "ad_source_type" TEXT,
    "ad_ctwa_clid" TEXT,
    "ad_headline" TEXT,
    "whatsappJid" TEXT,
    "whatsapp_bsuid" TEXT,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "assignedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_phone_changes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "old_phone" TEXT,
    "new_phone" TEXT,
    "old_bsuid" TEXT,
    "new_bsuid" TEXT,
    "source" "ContactPhoneChangeSource" NOT NULL DEFAULT 'WHATSAPP_SYSTEM',
    "raw_system_body" TEXT,
    "message_external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_phone_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "size" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags_on_contacts" (
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "tags_on_contacts_pkey" PRIMARY KEY ("contactId","tagId")
);

-- CreateTable
CREATE TABLE "tags_on_deals" (
    "dealId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "tags_on_deals_pkey" PRIMARY KEY ("dealId","tagId")
);

-- CreateTable
CREATE TABLE "custom_fields" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "options" TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "entity" TEXT NOT NULL DEFAULT 'contact',
    "showInInboxLeadPanel" BOOLEAN NOT NULL DEFAULT false,
    "inboxLeadPanelOrder" INTEGER,

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_custom_field_values" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,

    CONSTRAINT "contact_custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_custom_field_values" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,

    CONSTRAINT "deal_custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipelines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "winProbability" INTEGER NOT NULL DEFAULT 0,
    "rottingDays" INTEGER NOT NULL DEFAULT 30,
    "isIncoming" BOOLEAN NOT NULL DEFAULT false,
    "pipelineId" TEXT NOT NULL,

    CONSTRAINT "stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "external_id" TEXT,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "DealStatus" NOT NULL DEFAULT 'OPEN',
    "expectedClose" TIMESTAMP(3),
    "lostReason" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "contactId" TEXT,
    "stageId" TEXT NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'un',
    "type" TEXT NOT NULL DEFAULT 'PRODUCT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_custom_field_values" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "product_custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_products" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "contactId" TEXT,
    "dealId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contactId" TEXT,
    "dealId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT,
    "channel" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "inboxName" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastReadAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastMessageDirection" TEXT,
    "hasAgentReply" BOOLEAN NOT NULL DEFAULT false,
    "hasError" BOOLEAN NOT NULL DEFAULT false,
    "pinnedNoteId" TEXT,
    "aiGreetedAt" TIMESTAMP(3),
    "contactId" TEXT NOT NULL,
    "channelId" TEXT,
    "waJid" TEXT,
    "assignedToId" TEXT,
    "whatsappCallConsentStatus" "WhatsappCallConsentStatus" NOT NULL DEFAULT 'NONE',
    "whatsappCallConsentUpdatedAt" TIMESTAMP(3),
    "whatsappCallConsentType" "WhatsappCallConsentType",
    "whatsappCallConsentExpiresAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_call_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "metaCallId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "eventKind" TEXT NOT NULL,
    "signalingStatus" TEXT,
    "terminateStatus" TEXT,
    "fromWa" TEXT,
    "toWa" TEXT,
    "durationSec" INTEGER,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "bizOpaque" TEXT,
    "errorsJson" JSONB,
    "conversationId" TEXT,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_call_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'text',
    "authorType" "MessageAuthorType" NOT NULL DEFAULT 'human',
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "externalId" TEXT,
    "senderName" TEXT,
    "aiAgentUserId" TEXT,
    "mediaUrl" TEXT,
    "replyToId" TEXT,
    "replyToPreview" TEXT,
    "reactions" JSONB NOT NULL DEFAULT '[]',
    "sendStatus" TEXT NOT NULL DEFAULT 'sent',
    "sendError" TEXT,
    "flow_token" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "triggerType" TEXT NOT NULL,
    "triggerConfig" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_steps" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "automationId" TEXT NOT NULL,

    CONSTRAINT "automation_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "contactId" TEXT,
    "dealId" TEXT,
    "stepId" TEXT,
    "stepType" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "payload" JSONB,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "provider" "ChannelProvider" NOT NULL,
    "status" "ChannelStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "config" JSONB NOT NULL DEFAULT '{}',
    "phoneNumber" TEXT,
    "lastConnectedAt" TIMESTAMP(3),
    "qrCode" TEXT,
    "sessionData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baileys_auth_keys" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "keyType" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "baileys_auth_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quick_replies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quick_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "language" TEXT NOT NULL DEFAULT 'pt_BR',
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "channelType" "ChannelType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_template_configs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meta_template_id" TEXT NOT NULL,
    "meta_template_name" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "agent_enabled" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'pt_BR',
    "category" TEXT,
    "body_preview" TEXT NOT NULL DEFAULT '',
    "has_buttons" BOOLEAN NOT NULL DEFAULT false,
    "button_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "has_variables" BOOLEAN NOT NULL DEFAULT false,
    "flow_action" TEXT,
    "flow_id" TEXT,
    "operator_variables" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_template_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_flow_definitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "WhatsappFlowStatus" NOT NULL DEFAULT 'DRAFT',
    "meta_flow_id" TEXT,
    "flow_category" TEXT NOT NULL DEFAULT 'LEAD_GENERATION',
    "generator_version" TEXT NOT NULL DEFAULT '1',
    "meta_json_version" TEXT,
    "published_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_flow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_flow_screens" (
    "id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,

    CONSTRAINT "whatsapp_flow_screens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_flow_fields" (
    "id" TEXT NOT NULL,
    "screen_id" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field_type" TEXT NOT NULL DEFAULT 'TEXT',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "whatsapp_flow_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_flow_field_mappings" (
    "id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "target_kind" "FlowFieldMappingTargetKind" NOT NULL,
    "native_key" TEXT,
    "custom_field_id" TEXT,

    CONSTRAINT "whatsapp_flow_field_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distribution_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "DistributionMode" NOT NULL DEFAULT 'ROUND_ROBIN',
    "pipelineId" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distribution_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distribution_members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "distribution_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_contexts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "currentStepId" TEXT,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "status" "AutomationCtxStatus" NOT NULL DEFAULT 'RUNNING',
    "timeoutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "agent_schedules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startTime" TEXT NOT NULL DEFAULT '08:00',
    "lunchStart" TEXT NOT NULL DEFAULT '12:00',
    "lunchEnd" TEXT NOT NULL DEFAULT '13:00',
    "endTime" TEXT NOT NULL DEFAULT '18:00',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "weekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_statuses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AgentOnlineStatus" NOT NULL DEFAULT 'OFFLINE',
    "availableForVoiceCalls" BOOLEAN NOT NULL DEFAULT false,
    "lastActivityAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_presence_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AgentOnlineStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_presence_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_whatsapp_calls" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "assigneeUserId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledWhatsappCallStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "sourceMetaCallId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_whatsapp_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loss_reasons" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loss_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "type" "CampaignType" NOT NULL,
    "channelId" TEXT NOT NULL,
    "segmentId" TEXT,
    "filters" JSONB,
    "templateName" TEXT,
    "templateLanguage" TEXT DEFAULT 'pt_BR',
    "templateComponents" JSONB,
    "textContent" TEXT,
    "automationId" TEXT,
    "sendRate" INTEGER NOT NULL DEFAULT 80,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "readCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "metaMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_layout_config" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bottomNavModuleIds" TEXT NOT NULL DEFAULT 'inbox,pipeline,tasks,contacts',
    "enabledModuleIds" TEXT NOT NULL DEFAULT 'inbox,pipeline,tasks,contacts,companies,settings,profile',
    "startRoute" TEXT NOT NULL DEFAULT '/inbox',
    "brandColor" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "mobile_layout_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_push_subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "web_push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_pricing_daily_metrics" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "pricingType" TEXT NOT NULL,
    "pricingCategory" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "phoneNumber" TEXT NOT NULL DEFAULT '',
    "tier" TEXT NOT NULL DEFAULT '',
    "volume" INTEGER NOT NULL DEFAULT 0,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_pricing_daily_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_configs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "archetype" "AIAgentArchetype" NOT NULL DEFAULT 'SDR',
    "model" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 1024,
    "systemPromptTemplate" TEXT NOT NULL,
    "systemPromptOverride" TEXT,
    "productPolicy" TEXT,
    "tone" TEXT NOT NULL DEFAULT 'profissional e cordial',
    "language" TEXT NOT NULL DEFAULT 'pt-BR',
    "autonomyMode" "AIAgentAutonomy" NOT NULL DEFAULT 'DRAFT',
    "enabledTools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dailyTokenCap" INTEGER NOT NULL DEFAULT 0,
    "pipelineId" TEXT,
    "channelId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "openingMessage" TEXT,
    "openingDelayMs" INTEGER NOT NULL DEFAULT 0,
    "inactivityTimerMs" INTEGER NOT NULL DEFAULT 0,
    "inactivityHandoffMode" TEXT NOT NULL DEFAULT 'KEEP_OWNER',
    "inactivityHandoffUserId" TEXT,
    "inactivityFarewellMessage" TEXT,
    "keywordHandoffs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "qualificationQuestions" JSONB NOT NULL DEFAULT '[]',
    "businessHours" JSONB,
    "outputStyle" TEXT NOT NULL DEFAULT 'conversational',
    "simulateTyping" BOOLEAN NOT NULL DEFAULT true,
    "typingPerCharMs" INTEGER NOT NULL DEFAULT 25,
    "markMessagesRead" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_agent_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_knowledge_docs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "mimeType" TEXT,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "storageUrl" TEXT,
    "status" "AIAgentKnowledgeStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_agent_knowledge_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_knowledge_chunks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'inbox',
    "conversationId" TEXT,
    "contactId" TEXT,
    "responsePreview" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "AIAgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ai_agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolName" TEXT,
    "toolData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "mediaName" TEXT,
    "fallbackTemplateName" TEXT,
    "fallbackTemplateParams" JSONB,
    "fallbackTemplateLanguage" TEXT,
    "status" "ScheduledMessageStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "sentMessageId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_status_idx" ON "organizations"("status");

-- CreateIndex
CREATE INDEX "organization_feature_flags_organizationId_idx" ON "organization_feature_flags"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_feature_flags_organizationId_key_key" ON "organization_feature_flags"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "organization_subscriptions_organizationId_key" ON "organization_subscriptions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_subscriptions_stripeCustomerId_key" ON "organization_subscriptions"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_subscriptions_stripeSubscriptionId_key" ON "organization_subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "organization_subscriptions_planKey_idx" ON "organization_subscriptions"("planKey");

-- CreateIndex
CREATE INDEX "organization_subscriptions_status_idx" ON "organization_subscriptions"("status");

-- CreateIndex
CREATE INDEX "usage_records_organizationId_meter_occurredAt_idx" ON "usage_records"("organizationId", "meter", "occurredAt");

-- CreateIndex
CREATE INDEX "usage_records_organizationId_reportedAt_idx" ON "usage_records"("organizationId", "reportedAt");

-- CreateIndex
CREATE INDEX "usage_records_meter_reportedAt_idx" ON "usage_records"("meter", "reportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "organization_invites_token_key" ON "organization_invites"("token");

-- CreateIndex
CREATE INDEX "organization_invites_organizationId_idx" ON "organization_invites"("organizationId");

-- CreateIndex
CREATE INDEX "organization_invites_email_idx" ON "organization_invites"("email");

-- CreateIndex
CREATE INDEX "organization_invites_expiresAt_idx" ON "organization_invites"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_type_idx" ON "users"("type");

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");

-- CreateIndex
CREATE INDEX "users_organizationId_role_idx" ON "users"("organizationId", "role");

-- CreateIndex
CREATE INDEX "users_organizationId_type_idx" ON "users"("organizationId", "type");

-- CreateIndex
CREATE INDEX "users_isSuperAdmin_idx" ON "users"("isSuperAdmin");

-- CreateIndex
CREATE INDEX "user_mfa_backup_codes_userId_idx" ON "user_mfa_backup_codes"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "login_attempts_email_createdAt_idx" ON "login_attempts"("email", "createdAt");

-- CreateIndex
CREATE INDEX "login_attempts_userId_createdAt_idx" ON "login_attempts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "login_attempts_createdAt_idx" ON "login_attempts"("createdAt");

-- CreateIndex
CREATE INDEX "data_requests_organizationId_createdAt_idx" ON "data_requests"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "data_requests_userId_type_createdAt_idx" ON "data_requests"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "data_requests_status_createdAt_idx" ON "data_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "user_dashboard_layouts_organizationId_idx" ON "user_dashboard_layouts"("organizationId");

-- CreateIndex
CREATE INDEX "user_dashboard_layouts_userId_isDefault_idx" ON "user_dashboard_layouts"("userId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "user_dashboard_layouts_userId_name_key" ON "user_dashboard_layouts"("userId", "name");

-- CreateIndex
CREATE INDEX "field_layout_configs_organizationId_context_idx" ON "field_layout_configs"("organizationId", "context");

-- CreateIndex
CREATE UNIQUE INDEX "field_layout_configs_organizationId_userId_context_key" ON "field_layout_configs"("organizationId", "userId", "context");

-- CreateIndex
CREATE INDEX "roles_organizationId_idx" ON "roles"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organizationId_name_key" ON "roles"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organizationId_systemPreset_key" ON "roles"("organizationId", "systemPreset");

-- CreateIndex
CREATE INDEX "user_role_assignments_organizationId_idx" ON "user_role_assignments"("organizationId");

-- CreateIndex
CREATE INDEX "user_role_assignments_userId_idx" ON "user_role_assignments"("userId");

-- CreateIndex
CREATE INDEX "user_role_assignments_roleId_idx" ON "user_role_assignments"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_assignments_userId_roleId_key" ON "user_role_assignments"("userId", "roleId");

-- CreateIndex
CREATE INDEX "organization_settings_organizationId_idx" ON "organization_settings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_settings_organizationId_key_key" ON "organization_settings"("organizationId", "key");

-- CreateIndex
CREATE INDEX "contacts_organizationId_idx" ON "contacts"("organizationId");

-- CreateIndex
CREATE INDEX "contacts_organizationId_email_idx" ON "contacts"("organizationId", "email");

-- CreateIndex
CREATE INDEX "contacts_organizationId_phone_idx" ON "contacts"("organizationId", "phone");

-- CreateIndex
CREATE INDEX "contacts_organizationId_whatsappJid_idx" ON "contacts"("organizationId", "whatsappJid");

-- CreateIndex
CREATE INDEX "contacts_organizationId_lifecycleStage_idx" ON "contacts"("organizationId", "lifecycleStage");

-- CreateIndex
CREATE INDEX "contacts_organizationId_leadScore_idx" ON "contacts"("organizationId", "leadScore");

-- CreateIndex
CREATE INDEX "contacts_organizationId_companyId_idx" ON "contacts"("organizationId", "companyId");

-- CreateIndex
CREATE INDEX "contacts_organizationId_assignedToId_idx" ON "contacts"("organizationId", "assignedToId");

-- CreateIndex
CREATE INDEX "contacts_organizationId_createdAt_idx" ON "contacts"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "contacts_organizationId_updatedAt_idx" ON "contacts"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "contacts_organizationId_assignedToId_lifecycleStage_idx" ON "contacts"("organizationId", "assignedToId", "lifecycleStage");

-- CreateIndex
CREATE INDEX "contacts_organizationId_lifecycleStage_createdAt_idx" ON "contacts"("organizationId", "lifecycleStage", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_organizationId_external_id_key" ON "contacts"("organizationId", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_organizationId_whatsapp_bsuid_key" ON "contacts"("organizationId", "whatsapp_bsuid");

-- CreateIndex
CREATE UNIQUE INDEX "contact_phone_changes_message_external_id_key" ON "contact_phone_changes"("message_external_id");

-- CreateIndex
CREATE INDEX "contact_phone_changes_organizationId_idx" ON "contact_phone_changes"("organizationId");

-- CreateIndex
CREATE INDEX "contact_phone_changes_contactId_idx" ON "contact_phone_changes"("contactId");

-- CreateIndex
CREATE INDEX "contact_phone_changes_created_at_idx" ON "contact_phone_changes"("created_at");

-- CreateIndex
CREATE INDEX "contact_phone_changes_source_idx" ON "contact_phone_changes"("source");

-- CreateIndex
CREATE INDEX "contact_phone_changes_organizationId_source_created_at_idx" ON "contact_phone_changes"("organizationId", "source", "created_at");

-- CreateIndex
CREATE INDEX "companies_organizationId_idx" ON "companies"("organizationId");

-- CreateIndex
CREATE INDEX "companies_organizationId_name_idx" ON "companies"("organizationId", "name");

-- CreateIndex
CREATE INDEX "tags_organizationId_idx" ON "tags"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "tags_organizationId_name_key" ON "tags"("organizationId", "name");

-- CreateIndex
CREATE INDEX "tags_on_contacts_tagId_idx" ON "tags_on_contacts"("tagId");

-- CreateIndex
CREATE INDEX "tags_on_deals_tagId_idx" ON "tags_on_deals"("tagId");

-- CreateIndex
CREATE INDEX "custom_fields_organizationId_idx" ON "custom_fields"("organizationId");

-- CreateIndex
CREATE INDEX "custom_fields_organizationId_entity_idx" ON "custom_fields"("organizationId", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "custom_fields_organizationId_name_entity_key" ON "custom_fields"("organizationId", "name", "entity");

-- CreateIndex
CREATE INDEX "contact_custom_field_values_organizationId_idx" ON "contact_custom_field_values"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_custom_field_values_contactId_customFieldId_key" ON "contact_custom_field_values"("contactId", "customFieldId");

-- CreateIndex
CREATE INDEX "deal_custom_field_values_organizationId_idx" ON "deal_custom_field_values"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "deal_custom_field_values_dealId_customFieldId_key" ON "deal_custom_field_values"("dealId", "customFieldId");

-- CreateIndex
CREATE INDEX "pipelines_organizationId_idx" ON "pipelines"("organizationId");

-- CreateIndex
CREATE INDEX "pipelines_organizationId_isDefault_idx" ON "pipelines"("organizationId", "isDefault");

-- CreateIndex
CREATE INDEX "stages_organizationId_idx" ON "stages"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "stages_pipelineId_position_key" ON "stages"("pipelineId", "position");

-- CreateIndex
CREATE INDEX "deals_organizationId_idx" ON "deals"("organizationId");

-- CreateIndex
CREATE INDEX "deals_organizationId_status_idx" ON "deals"("organizationId", "status");

-- CreateIndex
CREATE INDEX "deals_organizationId_stageId_idx" ON "deals"("organizationId", "stageId");

-- CreateIndex
CREATE INDEX "deals_organizationId_contactId_idx" ON "deals"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "deals_organizationId_ownerId_idx" ON "deals"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "deals_organizationId_createdAt_idx" ON "deals"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "deals_organizationId_stageId_status_idx" ON "deals"("organizationId", "stageId", "status");

-- CreateIndex
CREATE INDEX "deals_organizationId_stageId_position_idx" ON "deals"("organizationId", "stageId", "position");

-- CreateIndex
CREATE INDEX "deals_organizationId_contactId_status_idx" ON "deals"("organizationId", "contactId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "deals_organizationId_number_key" ON "deals"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "deals_organizationId_external_id_key" ON "deals"("organizationId", "external_id");

-- CreateIndex
CREATE INDEX "products_organizationId_idx" ON "products"("organizationId");

-- CreateIndex
CREATE INDEX "products_organizationId_isActive_idx" ON "products"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "products_organizationId_name_idx" ON "products"("organizationId", "name");

-- CreateIndex
CREATE INDEX "products_organizationId_type_idx" ON "products"("organizationId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "products_organizationId_sku_key" ON "products"("organizationId", "sku");

-- CreateIndex
CREATE INDEX "product_custom_field_values_organizationId_idx" ON "product_custom_field_values"("organizationId");

-- CreateIndex
CREATE INDEX "product_custom_field_values_productId_idx" ON "product_custom_field_values"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_custom_field_values_productId_customFieldId_key" ON "product_custom_field_values"("productId", "customFieldId");

-- CreateIndex
CREATE INDEX "deal_products_organizationId_idx" ON "deal_products"("organizationId");

-- CreateIndex
CREATE INDEX "deal_products_dealId_idx" ON "deal_products"("dealId");

-- CreateIndex
CREATE INDEX "deal_products_productId_idx" ON "deal_products"("productId");

-- CreateIndex
CREATE INDEX "deal_events_organizationId_idx" ON "deal_events"("organizationId");

-- CreateIndex
CREATE INDEX "deal_events_dealId_createdAt_idx" ON "deal_events"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "deal_events_userId_idx" ON "deal_events"("userId");

-- CreateIndex
CREATE INDEX "activities_organizationId_idx" ON "activities"("organizationId");

-- CreateIndex
CREATE INDEX "activities_organizationId_scheduledAt_idx" ON "activities"("organizationId", "scheduledAt");

-- CreateIndex
CREATE INDEX "activities_organizationId_userId_idx" ON "activities"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "activities_organizationId_completed_scheduledAt_idx" ON "activities"("organizationId", "completed", "scheduledAt");

-- CreateIndex
CREATE INDEX "activities_contactId_idx" ON "activities"("contactId");

-- CreateIndex
CREATE INDEX "activities_dealId_idx" ON "activities"("dealId");

-- CreateIndex
CREATE INDEX "activities_dealId_scheduledAt_idx" ON "activities"("dealId", "scheduledAt");

-- CreateIndex
CREATE INDEX "notes_organizationId_idx" ON "notes"("organizationId");

-- CreateIndex
CREATE INDEX "notes_contactId_idx" ON "notes"("contactId");

-- CreateIndex
CREATE INDEX "notes_dealId_idx" ON "notes"("dealId");

-- CreateIndex
CREATE INDEX "notes_userId_idx" ON "notes"("userId");

-- CreateIndex
CREATE INDEX "notes_dealId_createdAt_idx" ON "notes"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "notes_contactId_createdAt_idx" ON "notes"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "conversations_organizationId_idx" ON "conversations"("organizationId");

-- CreateIndex
CREATE INDEX "conversations_organizationId_status_idx" ON "conversations"("organizationId", "status");

-- CreateIndex
CREATE INDEX "conversations_organizationId_status_updatedAt_idx" ON "conversations"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "conversations_organizationId_contactId_idx" ON "conversations"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "conversations_organizationId_assignedToId_idx" ON "conversations"("organizationId", "assignedToId");

-- CreateIndex
CREATE INDEX "conversations_organizationId_channelId_idx" ON "conversations"("organizationId", "channelId");

-- CreateIndex
CREATE INDEX "conversations_contactId_updatedAt_idx" ON "conversations"("contactId", "updatedAt");

-- CreateIndex
CREATE INDEX "conversations_contactId_status_idx" ON "conversations"("contactId", "status");

-- CreateIndex
CREATE INDEX "conversations_hasError_idx" ON "conversations"("hasError");

-- CreateIndex
CREATE INDEX "conversations_lastMessageDirection_hasAgentReply_idx" ON "conversations"("lastMessageDirection", "hasAgentReply");

-- CreateIndex
CREATE INDEX "conversations_whatsappCallConsentStatus_idx" ON "conversations"("whatsappCallConsentStatus");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_organizationId_externalId_key" ON "conversations"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "whatsapp_call_events_organizationId_idx" ON "whatsapp_call_events"("organizationId");

-- CreateIndex
CREATE INDEX "whatsapp_call_events_metaCallId_idx" ON "whatsapp_call_events"("metaCallId");

-- CreateIndex
CREATE INDEX "whatsapp_call_events_conversationId_createdAt_idx" ON "whatsapp_call_events"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "whatsapp_call_events_contactId_createdAt_idx" ON "whatsapp_call_events"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "whatsapp_call_events_createdAt_idx" ON "whatsapp_call_events"("createdAt");

-- CreateIndex
CREATE INDEX "messages_organizationId_idx" ON "messages"("organizationId");

-- CreateIndex
CREATE INDEX "messages_organizationId_createdAt_idx" ON "messages"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_conversationId_authorType_createdAt_idx" ON "messages"("conversationId", "authorType", "createdAt");

-- CreateIndex
CREATE INDEX "messages_externalId_idx" ON "messages"("externalId");

-- CreateIndex
CREATE INDEX "messages_aiAgentUserId_createdAt_idx" ON "messages"("aiAgentUserId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_createdAt_idx" ON "messages"("createdAt");

-- CreateIndex
CREATE INDEX "automations_organizationId_idx" ON "automations"("organizationId");

-- CreateIndex
CREATE INDEX "automations_organizationId_active_idx" ON "automations"("organizationId", "active");

-- CreateIndex
CREATE INDEX "automations_organizationId_active_triggerType_idx" ON "automations"("organizationId", "active", "triggerType");

-- CreateIndex
CREATE INDEX "automation_steps_organizationId_idx" ON "automation_steps"("organizationId");

-- CreateIndex
CREATE INDEX "automation_steps_automationId_idx" ON "automation_steps"("automationId");

-- CreateIndex
CREATE INDEX "automation_steps_automationId_position_idx" ON "automation_steps"("automationId", "position");

-- CreateIndex
CREATE INDEX "automation_logs_organizationId_idx" ON "automation_logs"("organizationId");

-- CreateIndex
CREATE INDEX "automation_logs_automationId_idx" ON "automation_logs"("automationId");

-- CreateIndex
CREATE INDEX "automation_logs_contactId_idx" ON "automation_logs"("contactId");

-- CreateIndex
CREATE INDEX "automation_logs_dealId_idx" ON "automation_logs"("dealId");

-- CreateIndex
CREATE INDEX "automation_logs_executedAt_idx" ON "automation_logs"("executedAt");

-- CreateIndex
CREATE INDEX "automation_logs_automationId_executedAt_idx" ON "automation_logs"("automationId", "executedAt");

-- CreateIndex
CREATE INDEX "automation_logs_automationId_stepId_idx" ON "automation_logs"("automationId", "stepId");

-- CreateIndex
CREATE INDEX "channels_organizationId_idx" ON "channels"("organizationId");

-- CreateIndex
CREATE INDEX "channels_organizationId_status_idx" ON "channels"("organizationId", "status");

-- CreateIndex
CREATE INDEX "channels_organizationId_type_status_idx" ON "channels"("organizationId", "type", "status");

-- CreateIndex
CREATE INDEX "channels_organizationId_provider_status_idx" ON "channels"("organizationId", "provider", "status");

-- CreateIndex
CREATE INDEX "channels_phoneNumber_idx" ON "channels"("phoneNumber");

-- CreateIndex
CREATE INDEX "baileys_auth_keys_organizationId_idx" ON "baileys_auth_keys"("organizationId");

-- CreateIndex
CREATE INDEX "baileys_auth_keys_channelId_idx" ON "baileys_auth_keys"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "baileys_auth_keys_channelId_keyType_keyId_key" ON "baileys_auth_keys"("channelId", "keyType", "keyId");

-- CreateIndex
CREATE INDEX "quick_replies_organizationId_idx" ON "quick_replies"("organizationId");

-- CreateIndex
CREATE INDEX "quick_replies_organizationId_category_idx" ON "quick_replies"("organizationId", "category");

-- CreateIndex
CREATE INDEX "message_templates_organizationId_idx" ON "message_templates"("organizationId");

-- CreateIndex
CREATE INDEX "message_templates_organizationId_status_idx" ON "message_templates"("organizationId", "status");

-- CreateIndex
CREATE INDEX "whatsapp_template_configs_organizationId_idx" ON "whatsapp_template_configs"("organizationId");

-- CreateIndex
CREATE INDEX "whatsapp_template_configs_organizationId_agent_enabled_idx" ON "whatsapp_template_configs"("organizationId", "agent_enabled");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_template_configs_organizationId_meta_template_id_key" ON "whatsapp_template_configs"("organizationId", "meta_template_id");

-- CreateIndex
CREATE INDEX "whatsapp_flow_definitions_organizationId_idx" ON "whatsapp_flow_definitions"("organizationId");

-- CreateIndex
CREATE INDEX "whatsapp_flow_definitions_organizationId_status_idx" ON "whatsapp_flow_definitions"("organizationId", "status");

-- CreateIndex
CREATE INDEX "whatsapp_flow_screens_flow_id_idx" ON "whatsapp_flow_screens"("flow_id");

-- CreateIndex
CREATE INDEX "whatsapp_flow_fields_screen_id_idx" ON "whatsapp_flow_fields"("screen_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_flow_fields_screen_id_field_key_key" ON "whatsapp_flow_fields"("screen_id", "field_key");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_flow_field_mappings_field_id_key" ON "whatsapp_flow_field_mappings"("field_id");

-- CreateIndex
CREATE INDEX "whatsapp_flow_field_mappings_custom_field_id_idx" ON "whatsapp_flow_field_mappings"("custom_field_id");

-- CreateIndex
CREATE INDEX "distribution_rules_organizationId_idx" ON "distribution_rules"("organizationId");

-- CreateIndex
CREATE INDEX "distribution_rules_organizationId_isActive_idx" ON "distribution_rules"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "distribution_members_organizationId_idx" ON "distribution_members"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "distribution_members_ruleId_userId_key" ON "distribution_members"("ruleId", "userId");

-- CreateIndex
CREATE INDEX "automation_contexts_organizationId_idx" ON "automation_contexts"("organizationId");

-- CreateIndex
CREATE INDEX "automation_contexts_automationId_contactId_idx" ON "automation_contexts"("automationId", "contactId");

-- CreateIndex
CREATE INDEX "automation_contexts_contactId_status_idx" ON "automation_contexts"("contactId", "status");

-- CreateIndex
CREATE INDEX "automation_contexts_status_timeoutAt_idx" ON "automation_contexts"("status", "timeoutAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_schedules_userId_key" ON "agent_schedules"("userId");

-- CreateIndex
CREATE INDEX "agent_schedules_organizationId_idx" ON "agent_schedules"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_statuses_userId_key" ON "agent_statuses"("userId");

-- CreateIndex
CREATE INDEX "agent_statuses_organizationId_idx" ON "agent_statuses"("organizationId");

-- CreateIndex
CREATE INDEX "agent_statuses_organizationId_status_idx" ON "agent_statuses"("organizationId", "status");

-- CreateIndex
CREATE INDEX "agent_statuses_status_lastActivityAt_idx" ON "agent_statuses"("status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "agent_presence_logs_organizationId_idx" ON "agent_presence_logs"("organizationId");

-- CreateIndex
CREATE INDEX "agent_presence_logs_userId_startedAt_idx" ON "agent_presence_logs"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "agent_presence_logs_userId_endedAt_idx" ON "agent_presence_logs"("userId", "endedAt");

-- CreateIndex
CREATE INDEX "agent_presence_logs_userId_status_startedAt_idx" ON "agent_presence_logs"("userId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "scheduled_whatsapp_calls_organizationId_idx" ON "scheduled_whatsapp_calls"("organizationId");

-- CreateIndex
CREATE INDEX "scheduled_whatsapp_calls_conversationId_scheduledAt_idx" ON "scheduled_whatsapp_calls"("conversationId", "scheduledAt");

-- CreateIndex
CREATE INDEX "scheduled_whatsapp_calls_assigneeUserId_scheduledAt_status_idx" ON "scheduled_whatsapp_calls"("assigneeUserId", "scheduledAt", "status");

-- CreateIndex
CREATE INDEX "scheduled_whatsapp_calls_status_scheduledAt_idx" ON "scheduled_whatsapp_calls"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "loss_reasons_organizationId_idx" ON "loss_reasons"("organizationId");

-- CreateIndex
CREATE INDEX "loss_reasons_organizationId_isActive_position_idx" ON "loss_reasons"("organizationId", "isActive", "position");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_tokenHash_key" ON "api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "api_tokens_organizationId_idx" ON "api_tokens"("organizationId");

-- CreateIndex
CREATE INDEX "api_tokens_tokenHash_idx" ON "api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "api_tokens_userId_idx" ON "api_tokens"("userId");

-- CreateIndex
CREATE INDEX "segments_organizationId_idx" ON "segments"("organizationId");

-- CreateIndex
CREATE INDEX "campaigns_organizationId_idx" ON "campaigns"("organizationId");

-- CreateIndex
CREATE INDEX "campaigns_organizationId_status_idx" ON "campaigns"("organizationId", "status");

-- CreateIndex
CREATE INDEX "campaigns_organizationId_type_idx" ON "campaigns"("organizationId", "type");

-- CreateIndex
CREATE INDEX "campaigns_organizationId_scheduledAt_idx" ON "campaigns"("organizationId", "scheduledAt");

-- CreateIndex
CREATE INDEX "campaigns_channelId_idx" ON "campaigns"("channelId");

-- CreateIndex
CREATE INDEX "campaigns_createdById_idx" ON "campaigns"("createdById");

-- CreateIndex
CREATE INDEX "campaigns_status_scheduledAt_idx" ON "campaigns"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "campaign_recipients_organizationId_idx" ON "campaign_recipients"("organizationId");

-- CreateIndex
CREATE INDEX "campaign_recipients_campaignId_status_idx" ON "campaign_recipients"("campaignId", "status");

-- CreateIndex
CREATE INDEX "campaign_recipients_contactId_idx" ON "campaign_recipients"("contactId");

-- CreateIndex
CREATE INDEX "campaign_recipients_metaMessageId_idx" ON "campaign_recipients"("metaMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_campaignId_contactId_key" ON "campaign_recipients"("campaignId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_layout_config_organizationId_key" ON "mobile_layout_config"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "web_push_subscriptions_endpoint_key" ON "web_push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "web_push_subscriptions_organizationId_idx" ON "web_push_subscriptions"("organizationId");

-- CreateIndex
CREATE INDEX "web_push_subscriptions_userId_idx" ON "web_push_subscriptions"("userId");

-- CreateIndex
CREATE INDEX "web_push_subscriptions_failedAt_idx" ON "web_push_subscriptions"("failedAt");

-- CreateIndex
CREATE INDEX "meta_pricing_daily_metrics_date_idx" ON "meta_pricing_daily_metrics"("date");

-- CreateIndex
CREATE INDEX "meta_pricing_daily_metrics_pricingCategory_idx" ON "meta_pricing_daily_metrics"("pricingCategory");

-- CreateIndex
CREATE UNIQUE INDEX "meta_pricing_unique_combo" ON "meta_pricing_daily_metrics"("date", "pricingType", "pricingCategory", "country", "phoneNumber", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "ai_agent_configs_userId_key" ON "ai_agent_configs"("userId");

-- CreateIndex
CREATE INDEX "ai_agent_configs_organizationId_idx" ON "ai_agent_configs"("organizationId");

-- CreateIndex
CREATE INDEX "ai_agent_configs_organizationId_active_idx" ON "ai_agent_configs"("organizationId", "active");

-- CreateIndex
CREATE INDEX "ai_agent_configs_archetype_idx" ON "ai_agent_configs"("archetype");

-- CreateIndex
CREATE INDEX "ai_agent_knowledge_docs_organizationId_idx" ON "ai_agent_knowledge_docs"("organizationId");

-- CreateIndex
CREATE INDEX "ai_agent_knowledge_docs_agentId_status_idx" ON "ai_agent_knowledge_docs"("agentId", "status");

-- CreateIndex
CREATE INDEX "ai_agent_knowledge_chunks_organizationId_idx" ON "ai_agent_knowledge_chunks"("organizationId");

-- CreateIndex
CREATE INDEX "ai_agent_knowledge_chunks_docId_idx" ON "ai_agent_knowledge_chunks"("docId");

-- CreateIndex
CREATE INDEX "ai_agent_runs_organizationId_idx" ON "ai_agent_runs"("organizationId");

-- CreateIndex
CREATE INDEX "ai_agent_runs_agentId_createdAt_idx" ON "ai_agent_runs"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_agent_runs_conversationId_idx" ON "ai_agent_runs"("conversationId");

-- CreateIndex
CREATE INDEX "ai_agent_runs_status_idx" ON "ai_agent_runs"("status");

-- CreateIndex
CREATE INDEX "ai_agent_messages_organizationId_idx" ON "ai_agent_messages"("organizationId");

-- CreateIndex
CREATE INDEX "ai_agent_messages_runId_createdAt_idx" ON "ai_agent_messages"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "scheduled_messages_organizationId_idx" ON "scheduled_messages"("organizationId");

-- CreateIndex
CREATE INDEX "scheduled_messages_conversationId_status_idx" ON "scheduled_messages"("conversationId", "status");

-- CreateIndex
CREATE INDEX "scheduled_messages_status_scheduledAt_idx" ON "scheduled_messages"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "scheduled_messages_createdById_idx" ON "scheduled_messages"("createdById");

-- AddForeignKey
ALTER TABLE "organization_feature_flags" ADD CONSTRAINT "organization_feature_flags_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mfa_backup_codes" ADD CONSTRAINT "user_mfa_backup_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_dashboard_layouts" ADD CONSTRAINT "user_dashboard_layouts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_dashboard_layouts" ADD CONSTRAINT "user_dashboard_layouts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_layout_configs" ADD CONSTRAINT "field_layout_configs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_layout_configs" ADD CONSTRAINT "field_layout_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_phone_changes" ADD CONSTRAINT "contact_phone_changes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_phone_changes" ADD CONSTRAINT "contact_phone_changes_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags_on_contacts" ADD CONSTRAINT "tags_on_contacts_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags_on_contacts" ADD CONSTRAINT "tags_on_contacts_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags_on_deals" ADD CONSTRAINT "tags_on_deals_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags_on_deals" ADD CONSTRAINT "tags_on_deals_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_custom_field_values" ADD CONSTRAINT "contact_custom_field_values_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_custom_field_values" ADD CONSTRAINT "contact_custom_field_values_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_custom_field_values" ADD CONSTRAINT "contact_custom_field_values_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_custom_field_values" ADD CONSTRAINT "deal_custom_field_values_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_custom_field_values" ADD CONSTRAINT "deal_custom_field_values_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_custom_field_values" ADD CONSTRAINT "deal_custom_field_values_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stages" ADD CONSTRAINT "stages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stages" ADD CONSTRAINT "stages_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_custom_field_values" ADD CONSTRAINT "product_custom_field_values_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_custom_field_values" ADD CONSTRAINT "product_custom_field_values_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_custom_field_values" ADD CONSTRAINT "product_custom_field_values_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_products" ADD CONSTRAINT "deal_products_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_products" ADD CONSTRAINT "deal_products_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_products" ADD CONSTRAINT "deal_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_call_events" ADD CONSTRAINT "whatsapp_call_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_call_events" ADD CONSTRAINT "whatsapp_call_events_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_call_events" ADD CONSTRAINT "whatsapp_call_events_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_aiAgentUserId_fkey" FOREIGN KEY ("aiAgentUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_steps" ADD CONSTRAINT "automation_steps_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_steps" ADD CONSTRAINT "automation_steps_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baileys_auth_keys" ADD CONSTRAINT "baileys_auth_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baileys_auth_keys" ADD CONSTRAINT "baileys_auth_keys_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_template_configs" ADD CONSTRAINT "whatsapp_template_configs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_flow_definitions" ADD CONSTRAINT "whatsapp_flow_definitions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_flow_screens" ADD CONSTRAINT "whatsapp_flow_screens_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "whatsapp_flow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_flow_fields" ADD CONSTRAINT "whatsapp_flow_fields_screen_id_fkey" FOREIGN KEY ("screen_id") REFERENCES "whatsapp_flow_screens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_flow_field_mappings" ADD CONSTRAINT "whatsapp_flow_field_mappings_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "whatsapp_flow_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_flow_field_mappings" ADD CONSTRAINT "whatsapp_flow_field_mappings_custom_field_id_fkey" FOREIGN KEY ("custom_field_id") REFERENCES "custom_fields"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_rules" ADD CONSTRAINT "distribution_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_rules" ADD CONSTRAINT "distribution_rules_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_members" ADD CONSTRAINT "distribution_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_members" ADD CONSTRAINT "distribution_members_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "distribution_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_members" ADD CONSTRAINT "distribution_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_contexts" ADD CONSTRAINT "automation_contexts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_contexts" ADD CONSTRAINT "automation_contexts_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_contexts" ADD CONSTRAINT "automation_contexts_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_schedules" ADD CONSTRAINT "agent_schedules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_schedules" ADD CONSTRAINT "agent_schedules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_statuses" ADD CONSTRAINT "agent_statuses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_statuses" ADD CONSTRAINT "agent_statuses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_presence_logs" ADD CONSTRAINT "agent_presence_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_presence_logs" ADD CONSTRAINT "agent_presence_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_whatsapp_calls" ADD CONSTRAINT "scheduled_whatsapp_calls_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_whatsapp_calls" ADD CONSTRAINT "scheduled_whatsapp_calls_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_whatsapp_calls" ADD CONSTRAINT "scheduled_whatsapp_calls_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_whatsapp_calls" ADD CONSTRAINT "scheduled_whatsapp_calls_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loss_reasons" ADD CONSTRAINT "loss_reasons_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_layout_config" ADD CONSTRAINT "mobile_layout_config_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_configs" ADD CONSTRAINT "ai_agent_configs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_configs" ADD CONSTRAINT "ai_agent_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_knowledge_docs" ADD CONSTRAINT "ai_agent_knowledge_docs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_knowledge_docs" ADD CONSTRAINT "ai_agent_knowledge_docs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ai_agent_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_knowledge_chunks" ADD CONSTRAINT "ai_agent_knowledge_chunks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_knowledge_chunks" ADD CONSTRAINT "ai_agent_knowledge_chunks_docId_fkey" FOREIGN KEY ("docId") REFERENCES "ai_agent_knowledge_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ai_agent_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_messages" ADD CONSTRAINT "ai_agent_messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_messages" ADD CONSTRAINT "ai_agent_messages_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ai_agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

