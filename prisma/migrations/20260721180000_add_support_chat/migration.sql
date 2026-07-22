-- Chat interno de suporte: tickets (usuário ↔ time de suporte) com
-- distribuição ao agente online menos ocupado e fila (PENDING).

-- Enums
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'PENDING', 'RESOLVED');
CREATE TYPE "SupportMessageAuthorType" AS ENUM ('requester', 'agent', 'system');

-- Flag de departamento de suporte
ALTER TABLE "departments"
  ADD COLUMN "isSupport" BOOLEAN NOT NULL DEFAULT false;

-- Tickets
CREATE TABLE "support_tickets" (
  "id"              TEXT NOT NULL,
  "organizationId"  TEXT NOT NULL,
  "number"          INTEGER NOT NULL,
  "category"        TEXT NOT NULL,
  "description"     TEXT NOT NULL,
  "status"          "SupportTicketStatus" NOT NULL DEFAULT 'PENDING',
  "requesterId"     TEXT NOT NULL,
  "assignedToId"    TEXT,
  "departmentId"    TEXT,
  "lastMessageAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requesterUnread" INTEGER NOT NULL DEFAULT 0,
  "agentUnread"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "resolvedAt"      TIMESTAMP(3),
  CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_tickets_organizationId_status_idx"
  ON "support_tickets"("organizationId", "status");
CREATE INDEX "support_tickets_organizationId_assignedToId_idx"
  ON "support_tickets"("organizationId", "assignedToId");
CREATE INDEX "support_tickets_organizationId_requesterId_idx"
  ON "support_tickets"("organizationId", "requesterId");

ALTER TABLE "support_tickets"
  ADD CONSTRAINT "support_tickets_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_tickets"
  ADD CONSTRAINT "support_tickets_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_tickets"
  ADD CONSTRAINT "support_tickets_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "support_tickets"
  ADD CONSTRAINT "support_tickets_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "departments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Mensagens
CREATE TABLE "support_ticket_messages" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "ticketId"       TEXT NOT NULL,
  "authorId"       TEXT,
  "authorType"     "SupportMessageAuthorType" NOT NULL,
  "content"        TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_ticket_messages_ticketId_idx"
  ON "support_ticket_messages"("ticketId");
CREATE INDEX "support_ticket_messages_organizationId_idx"
  ON "support_ticket_messages"("organizationId");

ALTER TABLE "support_ticket_messages"
  ADD CONSTRAINT "support_ticket_messages_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_ticket_messages"
  ADD CONSTRAINT "support_ticket_messages_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_ticket_messages"
  ADD CONSTRAINT "support_ticket_messages_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
