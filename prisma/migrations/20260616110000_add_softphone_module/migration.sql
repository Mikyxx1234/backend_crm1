-- Módulo Softphone (Fase 1) — cria as 4 tabelas + 5 enums que vivem no schema
-- (commit 572f06e — feat(softphone)) mas que nunca tiveram migration commitada
-- no repositório. Sem essas tabelas, qualquer query a prisma.sipExtension /
-- prisma.call / prisma.callEvent / prisma.callProviderConfig estoura P2010
-- ("relation does not exist") — e a migration seguinte
-- 20260622120000_api4com_provisioning quebra ao tentar ALTER TABLE
-- sip_extensions / calls.
--
-- Não inclui as colunas/índices adicionados depois pela 20260622120000
-- (telephony_enabled, api4com_user_id, api4com_gateway, provisioning_step,
-- provisioning_error, provisioned_at em sip_extensions; deal_id, metadata
-- em calls; FK calls→deals e índice calls_organizationId_dealId_idx) —
-- a 20260622120000 segue sendo a fonte da verdade pra esses ADD COLUMN.
--
-- Idempotente: usa IF NOT EXISTS e DO blocks para podermos rodar com
-- segurança em DBs que já foram corrigidos via hotfix manual (ex.: mfpi
-- testou local com prisma db push antes de gerar a migration).

-- =========================================================================
-- 1. Enums
-- =========================================================================
DO $$ BEGIN
  CREATE TYPE "SipExtensionStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CallStatus" AS ENUM (
    'RINGING',
    'ANSWERED',
    'COMPLETED',
    'MISSED',
    'BUSY',
    'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "WebhookAuthMode" AS ENUM ('HMAC', 'TOKEN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "RecordingDelivery" AS ENUM ('URL', 'INLINE', 'FETCH_LATER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =========================================================================
-- 2. sip_extensions
-- =========================================================================
CREATE TABLE IF NOT EXISTS "sip_extensions" (
  "id"                      TEXT NOT NULL,
  "organizationId"          TEXT NOT NULL,
  "user_id"                 TEXT NOT NULL,
  "label"                   TEXT NOT NULL,
  "sip_uri"                 TEXT NOT NULL,
  "auth_user"               TEXT NOT NULL,
  "auth_password_encrypted" TEXT NOT NULL,
  "ws_server"               TEXT NOT NULL,
  "stun_servers"            JSONB NOT NULL,
  "turn_server"             JSONB,
  "provider_meta"           JSONB,
  "status"                  "SipExtensionStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"              TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sip_extensions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sip_extensions_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sip_extensions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "sip_extensions_organizationId_userId_key"
  ON "sip_extensions" ("organizationId", "user_id");
CREATE INDEX IF NOT EXISTS "sip_extensions_organizationId_idx"
  ON "sip_extensions" ("organizationId");

-- =========================================================================
-- 3. calls
-- =========================================================================
CREATE TABLE IF NOT EXISTS "calls" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "direction"        "CallDirection" NOT NULL,
  "status"           "CallStatus" NOT NULL,
  "extension_id"     TEXT,
  "provider"         TEXT NOT NULL,
  "provider_call_id" TEXT NOT NULL,
  "from_number"      TEXT NOT NULL,
  "to_number"        TEXT NOT NULL,
  "contact_id"       TEXT,
  "started_at"       TIMESTAMP(3),
  "answered_at"      TIMESTAMP(3),
  "ended_at"         TIMESTAMP(3),
  "duration_seconds" INTEGER,
  "recording_url"    TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "calls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calls_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "calls_extension_id_fkey"
    FOREIGN KEY ("extension_id") REFERENCES "sip_extensions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "calls_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "calls_organizationId_provider_providerCallId_key"
  ON "calls" ("organizationId", "provider", "provider_call_id");
CREATE INDEX IF NOT EXISTS "calls_organizationId_contactId_idx"
  ON "calls" ("organizationId", "contact_id");
CREATE INDEX IF NOT EXISTS "calls_organizationId_direction_status_idx"
  ON "calls" ("organizationId", "direction", "status");
CREATE INDEX IF NOT EXISTS "calls_organizationId_extensionId_idx"
  ON "calls" ("organizationId", "extension_id");

-- =========================================================================
-- 4. call_events
-- =========================================================================
CREATE TABLE IF NOT EXISTS "call_events" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "call_id"        TEXT,
  "provider"       TEXT NOT NULL,
  "raw_payload"    JSONB NOT NULL,
  "received_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "call_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "call_events_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "call_events_call_id_fkey"
    FOREIGN KEY ("call_id") REFERENCES "calls"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "call_events_organizationId_idx"
  ON "call_events" ("organizationId");
CREATE INDEX IF NOT EXISTS "call_events_organizationId_callId_idx"
  ON "call_events" ("organizationId", "call_id");

-- =========================================================================
-- 5. call_provider_configs
-- =========================================================================
CREATE TABLE IF NOT EXISTS "call_provider_configs" (
  "id"                          TEXT NOT NULL,
  "organizationId"              TEXT NOT NULL,
  "provider_key"                TEXT NOT NULL,
  "field_mappings"              JSONB NOT NULL,
  "authMode"                    "WebhookAuthMode" NOT NULL,
  "webhook_secret_encrypted"    TEXT NOT NULL,
  "signature_header"            TEXT,
  "webhook_token"               TEXT NOT NULL,
  "recording_delivery"          "RecordingDelivery" NOT NULL,
  "create_contacts_for_calls"   BOOLEAN NOT NULL DEFAULT false,
  "is_active"                   BOOLEAN NOT NULL DEFAULT true,
  "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "call_provider_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "call_provider_configs_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "call_provider_configs_webhookToken_key"
  ON "call_provider_configs" ("webhook_token");
CREATE INDEX IF NOT EXISTS "call_provider_configs_organizationId_idx"
  ON "call_provider_configs" ("organizationId");
