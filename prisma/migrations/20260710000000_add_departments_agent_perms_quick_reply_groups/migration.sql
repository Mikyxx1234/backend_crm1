-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "businessHoursId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_permissions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canViewOtherAgentsConversations" BOOLEAN NOT NULL DEFAULT false,
    "disableConversationsWithoutAgent" BOOLEAN NOT NULL DEFAULT false,
    "canTransferConversation" BOOLEAN NOT NULL DEFAULT true,
    "canCloseConversation" BOOLEAN NOT NULL DEFAULT true,
    "canDeleteConversation" BOOLEAN NOT NULL DEFAULT false,
    "canManageQuickMessages" BOOLEAN NOT NULL DEFAULT false,
    "allowedConnectionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedDepartmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quick_reply_groups" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quick_reply_groups_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "departmentId" TEXT;

-- AlterTable
ALTER TABLE "quick_replies" ADD COLUMN "groupId" TEXT;
ALTER TABLE "quick_replies" ADD COLUMN "attachmentUrl" TEXT;
ALTER TABLE "quick_replies" ADD COLUMN "createdByUserId" TEXT;

-- CreateIndex
CREATE INDEX "departments_organizationId_idx" ON "departments"("organizationId");

-- CreateIndex
CREATE INDEX "agent_permissions_organizationId_idx" ON "agent_permissions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_permissions_organizationId_userId_key" ON "agent_permissions"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "quick_reply_groups_organizationId_idx" ON "quick_reply_groups"("organizationId");

-- CreateIndex
CREATE INDEX "quick_replies_organizationId_groupId_idx" ON "quick_replies"("organizationId", "groupId");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_permissions" ADD CONSTRAINT "agent_permissions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_permissions" ADD CONSTRAINT "agent_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_reply_groups" ADD CONSTRAINT "quick_reply_groups_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "quick_reply_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
