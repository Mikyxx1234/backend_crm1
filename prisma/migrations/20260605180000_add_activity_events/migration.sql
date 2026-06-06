-- Activity Log (Kommo-grade): log de atividade unificado e entity-agnostic.
--
-- Substitui gradualmente `deal_events` (que vira wrapper sobre este).
-- Eventos podem ter como sujeito DEAL, CONTACT, CONVERSATION, MESSAGE, etc.
-- Ator (actor) modelado com tipo + label/sublabel/ref para suportar
-- humano, IA, automacao, integracao e sistema.

-- Enum: ActorType
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ActorType') THEN
    CREATE TYPE "ActorType" AS ENUM ('HUMAN', 'AI', 'AUTOMATION', 'INTEGRATION', 'SYSTEM');
  END IF;
END$$;

-- Enum: EventEntityType
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EventEntityType') THEN
    CREATE TYPE "EventEntityType" AS ENUM (
      'DEAL', 'CONTACT', 'CONVERSATION', 'MESSAGE',
      'ACTIVITY', 'NOTE', 'TAG', 'PIPELINE', 'STAGE', 'AUTOMATION'
    );
  END IF;
END$$;

-- Tabela
CREATE TABLE "activity_events" (
    "id"             TEXT              NOT NULL,
    "organizationId" TEXT              NOT NULL,
    "occurredAt"     TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type"           TEXT              NOT NULL,

    "entityType"     "EventEntityType" NOT NULL,
    "entityId"       TEXT              NOT NULL,
    "entityLabel"    TEXT,

    "dealId"         TEXT,
    "contactId"      TEXT,
    "conversationId" TEXT,

    "actorType"      "ActorType"       NOT NULL,
    "actorUserId"    TEXT,
    "actorLabel"     TEXT,
    "actorSublabel"  TEXT,
    "actorRef"       TEXT,

    "field"          TEXT,
    "oldValue"       TEXT,
    "newValue"       TEXT,
    "meta"           JSONB             NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- Indices: acessos principais sao "feed da org cronologico" + "timeline
-- por entidade" + "filtros por ator/tipo".
CREATE INDEX "activity_events_org_occurredAt_idx"
    ON "activity_events"("organizationId", "occurredAt" DESC);
CREATE INDEX "activity_events_org_entity_occurredAt_idx"
    ON "activity_events"("organizationId", "entityType", "entityId", "occurredAt" DESC);
CREATE INDEX "activity_events_org_deal_occurredAt_idx"
    ON "activity_events"("organizationId", "dealId", "occurredAt" DESC);
CREATE INDEX "activity_events_org_contact_occurredAt_idx"
    ON "activity_events"("organizationId", "contactId", "occurredAt" DESC);
CREATE INDEX "activity_events_org_conv_occurredAt_idx"
    ON "activity_events"("organizationId", "conversationId", "occurredAt" DESC);
CREATE INDEX "activity_events_org_actorUser_occurredAt_idx"
    ON "activity_events"("organizationId", "actorUserId", "occurredAt" DESC);
CREATE INDEX "activity_events_org_type_occurredAt_idx"
    ON "activity_events"("organizationId", "type", "occurredAt" DESC);
CREATE INDEX "activity_events_org_actorType_occurredAt_idx"
    ON "activity_events"("organizationId", "actorType", "occurredAt" DESC);

-- FKs
ALTER TABLE "activity_events"
  ADD CONSTRAINT "activity_events_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activity_events"
  ADD CONSTRAINT "activity_events_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "activity_events"
  ADD CONSTRAINT "activity_events_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "deals"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activity_events"
  ADD CONSTRAINT "activity_events_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "contacts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activity_events"
  ADD CONSTRAINT "activity_events_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
