-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_dashboard_layouts" (
    "id" TEXT NOT NULL,
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
    "whatsappJid" TEXT,
    "whatsapp_bsuid" TEXT,
    "companyId" TEXT,
    "assignedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_phone_changes" (
    "id" TEXT NOT NULL,
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
    "value" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,

    CONSTRAINT "contact_custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_custom_field_values" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,

    CONSTRAINT "deal_custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipelines" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stages" (
    "id" TEXT NOT NULL,
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
    "external_id" TEXT,
    "number" SERIAL NOT NULL,
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
    "productId" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "product_custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_products" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
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
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "automationId" TEXT NOT NULL,

    CONSTRAINT "automation_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_logs" (
    "id" TEXT NOT NULL,
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
    "channelId" TEXT NOT NULL,
    "keyType" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "baileys_auth_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quick_replies" (
    "id" TEXT NOT NULL,
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
    "meta_template_id" TEXT NOT NULL,
    "meta_template_name" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "agent_enabled" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'pt_BR',
    "category" TEXT,
    "body_preview" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_template_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distribution_rules" (
    "id" TEXT NOT NULL,
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
    "ruleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "distribution_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_contexts" (
    "id" TEXT NOT NULL,
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
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loss_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL,
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
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
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
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_type_idx" ON "users"("type");

-- CreateIndex
CREATE INDEX "user_dashboard_layouts_userId_isDefault_idx" ON "user_dashboard_layouts"("userId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "user_dashboard_layouts_userId_name_key" ON "user_dashboard_layouts"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_external_id_key" ON "contacts"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_whatsapp_bsuid_key" ON "contacts"("whatsapp_bsuid");

-- CreateIndex
CREATE INDEX "contacts_email_idx" ON "contacts"("email");

-- CreateIndex
CREATE INDEX "contacts_phone_idx" ON "contacts"("phone");

-- CreateIndex
CREATE INDEX "contacts_whatsappJid_idx" ON "contacts"("whatsappJid");

-- CreateIndex
CREATE INDEX "contacts_lifecycleStage_idx" ON "contacts"("lifecycleStage");

-- CreateIndex
CREATE INDEX "contacts_leadScore_idx" ON "contacts"("leadScore");

-- CreateIndex
CREATE INDEX "contacts_companyId_idx" ON "contacts"("companyId");

-- CreateIndex
CREATE INDEX "contacts_assignedToId_idx" ON "contacts"("assignedToId");

-- CreateIndex
CREATE INDEX "contacts_createdAt_idx" ON "contacts"("createdAt");

-- CreateIndex
CREATE INDEX "contacts_updatedAt_idx" ON "contacts"("updatedAt");

-- CreateIndex
CREATE INDEX "contacts_assignedToId_lifecycleStage_idx" ON "contacts"("assignedToId", "lifecycleStage");

-- CreateIndex
CREATE INDEX "contacts_lifecycleStage_createdAt_idx" ON "contacts"("lifecycleStage", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "contact_phone_changes_message_external_id_key" ON "contact_phone_changes"("message_external_id");

-- CreateIndex
CREATE INDEX "contact_phone_changes_contactId_idx" ON "contact_phone_changes"("contactId");

-- CreateIndex
CREATE INDEX "contact_phone_changes_created_at_idx" ON "contact_phone_changes"("created_at");

-- CreateIndex
CREATE INDEX "contact_phone_changes_source_idx" ON "contact_phone_changes"("source");

-- CreateIndex
CREATE INDEX "contact_phone_changes_source_created_at_idx" ON "contact_phone_changes"("source", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE INDEX "tags_on_contacts_tagId_idx" ON "tags_on_contacts"("tagId");

-- CreateIndex
CREATE INDEX "tags_on_deals_tagId_idx" ON "tags_on_deals"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "custom_fields_name_entity_key" ON "custom_fields"("name", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "contact_custom_field_values_contactId_customFieldId_key" ON "contact_custom_field_values"("contactId", "customFieldId");

-- CreateIndex
CREATE UNIQUE INDEX "deal_custom_field_values_dealId_customFieldId_key" ON "deal_custom_field_values"("dealId", "customFieldId");

-- CreateIndex
CREATE UNIQUE INDEX "stages_pipelineId_position_key" ON "stages"("pipelineId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "deals_external_id_key" ON "deals"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "deals_number_key" ON "deals"("number");

-- CreateIndex
CREATE INDEX "deals_status_idx" ON "deals"("status");

-- CreateIndex
CREATE INDEX "deals_stageId_idx" ON "deals"("stageId");

-- CreateIndex
CREATE INDEX "deals_contactId_idx" ON "deals"("contactId");

-- CreateIndex
CREATE INDEX "deals_ownerId_idx" ON "deals"("ownerId");

-- CreateIndex
CREATE INDEX "deals_createdAt_idx" ON "deals"("createdAt");

-- CreateIndex
CREATE INDEX "deals_stageId_status_idx" ON "deals"("stageId", "status");

-- CreateIndex
CREATE INDEX "deals_stageId_position_idx" ON "deals"("stageId", "position");

-- CreateIndex
CREATE INDEX "deals_contactId_status_idx" ON "deals"("contactId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_isActive_idx" ON "products"("isActive");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- CreateIndex
CREATE INDEX "products_type_idx" ON "products"("type");

-- CreateIndex
CREATE INDEX "product_custom_field_values_productId_idx" ON "product_custom_field_values"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_custom_field_values_productId_customFieldId_key" ON "product_custom_field_values"("productId", "customFieldId");

-- CreateIndex
CREATE INDEX "deal_products_dealId_idx" ON "deal_products"("dealId");

-- CreateIndex
CREATE INDEX "deal_products_productId_idx" ON "deal_products"("productId");

-- CreateIndex
CREATE INDEX "deal_events_dealId_createdAt_idx" ON "deal_events"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "deal_events_userId_idx" ON "deal_events"("userId");

-- CreateIndex
CREATE INDEX "activities_scheduledAt_idx" ON "activities"("scheduledAt");

-- CreateIndex
CREATE INDEX "activities_contactId_idx" ON "activities"("contactId");

-- CreateIndex
CREATE INDEX "activities_dealId_idx" ON "activities"("dealId");

-- CreateIndex
CREATE INDEX "activities_userId_idx" ON "activities"("userId");

-- CreateIndex
CREATE INDEX "activities_dealId_scheduledAt_idx" ON "activities"("dealId", "scheduledAt");

-- CreateIndex
CREATE INDEX "activities_completed_scheduledAt_idx" ON "activities"("completed", "scheduledAt");

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
CREATE UNIQUE INDEX "conversations_externalId_key" ON "conversations"("externalId");

-- CreateIndex
CREATE INDEX "conversations_contactId_idx" ON "conversations"("contactId");

-- CreateIndex
CREATE INDEX "conversations_assignedToId_idx" ON "conversations"("assignedToId");

-- CreateIndex
CREATE INDEX "conversations_channelId_idx" ON "conversations"("channelId");

-- CreateIndex
CREATE INDEX "conversations_status_idx" ON "conversations"("status");

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
CREATE INDEX "conversations_status_updatedAt_idx" ON "conversations"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "whatsapp_call_events_metaCallId_idx" ON "whatsapp_call_events"("metaCallId");

-- CreateIndex
CREATE INDEX "whatsapp_call_events_conversationId_createdAt_idx" ON "whatsapp_call_events"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "whatsapp_call_events_contactId_createdAt_idx" ON "whatsapp_call_events"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "whatsapp_call_events_createdAt_idx" ON "whatsapp_call_events"("createdAt");

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
CREATE INDEX "automations_active_idx" ON "automations"("active");

-- CreateIndex
CREATE INDEX "automations_active_triggerType_idx" ON "automations"("active", "triggerType");

-- CreateIndex
CREATE INDEX "automation_steps_automationId_idx" ON "automation_steps"("automationId");

-- CreateIndex
CREATE INDEX "automation_steps_automationId_position_idx" ON "automation_steps"("automationId", "position");

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
CREATE INDEX "channels_status_idx" ON "channels"("status");

-- CreateIndex
CREATE INDEX "channels_type_status_idx" ON "channels"("type", "status");

-- CreateIndex
CREATE INDEX "channels_provider_status_idx" ON "channels"("provider", "status");

-- CreateIndex
CREATE INDEX "baileys_auth_keys_channelId_idx" ON "baileys_auth_keys"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "baileys_auth_keys_channelId_keyType_keyId_key" ON "baileys_auth_keys"("channelId", "keyType", "keyId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_template_configs_meta_template_id_key" ON "whatsapp_template_configs"("meta_template_id");

-- CreateIndex
CREATE INDEX "whatsapp_template_configs_agent_enabled_idx" ON "whatsapp_template_configs"("agent_enabled");

-- CreateIndex
CREATE UNIQUE INDEX "distribution_members_ruleId_userId_key" ON "distribution_members"("ruleId", "userId");

-- CreateIndex
CREATE INDEX "automation_contexts_automationId_contactId_idx" ON "automation_contexts"("automationId", "contactId");

-- CreateIndex
CREATE INDEX "automation_contexts_contactId_status_idx" ON "automation_contexts"("contactId", "status");

-- CreateIndex
CREATE INDEX "automation_contexts_status_timeoutAt_idx" ON "automation_contexts"("status", "timeoutAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_schedules_userId_key" ON "agent_schedules"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_statuses_userId_key" ON "agent_statuses"("userId");

-- CreateIndex
CREATE INDEX "agent_statuses_status_lastActivityAt_idx" ON "agent_statuses"("status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "agent_presence_logs_userId_startedAt_idx" ON "agent_presence_logs"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "agent_presence_logs_userId_endedAt_idx" ON "agent_presence_logs"("userId", "endedAt");

-- CreateIndex
CREATE INDEX "agent_presence_logs_userId_status_startedAt_idx" ON "agent_presence_logs"("userId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "scheduled_whatsapp_calls_conversationId_scheduledAt_idx" ON "scheduled_whatsapp_calls"("conversationId", "scheduledAt");

-- CreateIndex
CREATE INDEX "scheduled_whatsapp_calls_assigneeUserId_scheduledAt_status_idx" ON "scheduled_whatsapp_calls"("assigneeUserId", "scheduledAt", "status");

-- CreateIndex
CREATE INDEX "scheduled_whatsapp_calls_status_scheduledAt_idx" ON "scheduled_whatsapp_calls"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_tokenHash_key" ON "api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "api_tokens_tokenHash_idx" ON "api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "api_tokens_userId_idx" ON "api_tokens"("userId");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "campaigns_type_idx" ON "campaigns"("type");

-- CreateIndex
CREATE INDEX "campaigns_channelId_idx" ON "campaigns"("channelId");

-- CreateIndex
CREATE INDEX "campaigns_createdById_idx" ON "campaigns"("createdById");

-- CreateIndex
CREATE INDEX "campaigns_scheduledAt_idx" ON "campaigns"("scheduledAt");

-- CreateIndex
CREATE INDEX "campaigns_status_scheduledAt_idx" ON "campaigns"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "campaign_recipients_campaignId_status_idx" ON "campaign_recipients"("campaignId", "status");

-- CreateIndex
CREATE INDEX "campaign_recipients_contactId_idx" ON "campaign_recipients"("contactId");

-- CreateIndex
CREATE INDEX "campaign_recipients_metaMessageId_idx" ON "campaign_recipients"("metaMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_campaignId_contactId_key" ON "campaign_recipients"("campaignId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "web_push_subscriptions_endpoint_key" ON "web_push_subscriptions"("endpoint");

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
CREATE INDEX "ai_agent_configs_archetype_idx" ON "ai_agent_configs"("archetype");

-- CreateIndex
CREATE INDEX "ai_agent_configs_active_idx" ON "ai_agent_configs"("active");

-- CreateIndex
CREATE INDEX "ai_agent_knowledge_docs_agentId_status_idx" ON "ai_agent_knowledge_docs"("agentId", "status");

-- CreateIndex
CREATE INDEX "ai_agent_knowledge_chunks_docId_idx" ON "ai_agent_knowledge_chunks"("docId");

-- CreateIndex
CREATE INDEX "ai_agent_runs_agentId_createdAt_idx" ON "ai_agent_runs"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_agent_runs_conversationId_idx" ON "ai_agent_runs"("conversationId");

-- CreateIndex
CREATE INDEX "ai_agent_runs_status_idx" ON "ai_agent_runs"("status");

-- CreateIndex
CREATE INDEX "ai_agent_messages_runId_createdAt_idx" ON "ai_agent_messages"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "scheduled_messages_conversationId_status_idx" ON "scheduled_messages"("conversationId", "status");

-- CreateIndex
CREATE INDEX "scheduled_messages_status_scheduledAt_idx" ON "scheduled_messages"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "scheduled_messages_createdById_idx" ON "scheduled_messages"("createdById");

-- AddForeignKey
ALTER TABLE "user_dashboard_layouts" ADD CONSTRAINT "user_dashboard_layouts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_phone_changes" ADD CONSTRAINT "contact_phone_changes_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags_on_contacts" ADD CONSTRAINT "tags_on_contacts_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags_on_contacts" ADD CONSTRAINT "tags_on_contacts_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags_on_deals" ADD CONSTRAINT "tags_on_deals_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags_on_deals" ADD CONSTRAINT "tags_on_deals_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_custom_field_values" ADD CONSTRAINT "contact_custom_field_values_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_custom_field_values" ADD CONSTRAINT "contact_custom_field_values_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_custom_field_values" ADD CONSTRAINT "deal_custom_field_values_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_custom_field_values" ADD CONSTRAINT "deal_custom_field_values_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stages" ADD CONSTRAINT "stages_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_custom_field_values" ADD CONSTRAINT "product_custom_field_values_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_custom_field_values" ADD CONSTRAINT "product_custom_field_values_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_products" ADD CONSTRAINT "deal_products_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_products" ADD CONSTRAINT "deal_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_call_events" ADD CONSTRAINT "whatsapp_call_events_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_call_events" ADD CONSTRAINT "whatsapp_call_events_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_aiAgentUserId_fkey" FOREIGN KEY ("aiAgentUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_steps" ADD CONSTRAINT "automation_steps_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baileys_auth_keys" ADD CONSTRAINT "baileys_auth_keys_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_rules" ADD CONSTRAINT "distribution_rules_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_members" ADD CONSTRAINT "distribution_members_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "distribution_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_members" ADD CONSTRAINT "distribution_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_contexts" ADD CONSTRAINT "automation_contexts_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_contexts" ADD CONSTRAINT "automation_contexts_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_schedules" ADD CONSTRAINT "agent_schedules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_statuses" ADD CONSTRAINT "agent_statuses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_presence_logs" ADD CONSTRAINT "agent_presence_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_whatsapp_calls" ADD CONSTRAINT "scheduled_whatsapp_calls_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_whatsapp_calls" ADD CONSTRAINT "scheduled_whatsapp_calls_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_whatsapp_calls" ADD CONSTRAINT "scheduled_whatsapp_calls_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_configs" ADD CONSTRAINT "ai_agent_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_knowledge_docs" ADD CONSTRAINT "ai_agent_knowledge_docs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ai_agent_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_knowledge_chunks" ADD CONSTRAINT "ai_agent_knowledge_chunks_docId_fkey" FOREIGN KEY ("docId") REFERENCES "ai_agent_knowledge_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ai_agent_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_messages" ADD CONSTRAINT "ai_agent_messages_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ai_agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

