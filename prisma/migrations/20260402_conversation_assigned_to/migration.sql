-- Atribuição de conversa na inbox (agente responsável)
ALTER TABLE "conversations" ADD COLUMN "assignedToId" TEXT;

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "conversations_assignedToId_idx" ON "conversations"("assignedToId");
