import type { Prisma } from "@prisma/client";

export type AgentVisibilityContext = {
  id: string;
  role: string; // "ADMIN" | "MANAGER" | "AGENT" | etc.
  permission: {
    canViewOtherAgentsConversations: boolean;
    disableConversationsWithoutAgent: boolean;
    allowedDepartmentIds: string[];
    allowedConnectionIds: string[];
  } | null;
};

/**
 * Builds the Prisma `where` clause for conversations visible to an agent.
 *
 * Rules:
 * - admin/manager → see everything ({})
 * - canViewOtherAgentsConversations=true + no scopes → see everything ({})
 * - otherwise → own conversations + optionally unassigned + scoped by dept/conn
 */
export function buildConversationVisibilityWhere(
  agent: AgentVisibilityContext
): Prisma.ConversationWhereInput {
  // Admin/Manager see all
  if (agent.role === "ADMIN" || agent.role === "MANAGER") {
    return {};
  }

  const perm = agent.permission;
  const scopeConditions: Prisma.ConversationWhereInput = {};

  // Department scope filter
  if (perm?.allowedDepartmentIds?.length) {
    scopeConditions.departmentId = { in: perm.allowedDepartmentIds };
  }

  // Connection/channel scope filter
  if (perm?.allowedConnectionIds?.length) {
    scopeConditions.channelId = { in: perm.allowedConnectionIds };
  }

  // Can view all conversations (within scope)
  if (perm?.canViewOtherAgentsConversations) {
    return scopeConditions; // empty = unrestricted if no scopes defined
  }

  // Restricted: own + optionally unassigned
  const assignmentConditions: Prisma.ConversationWhereInput[] = [
    { assignedToId: agent.id },
  ];

  if (!perm?.disableConversationsWithoutAgent) {
    // Can see unassigned conversations (in queue)
    assignmentConditions.push({ assignedToId: null });
  }

  return {
    ...scopeConditions,
    OR: assignmentConditions,
  };
}

/**
 * Checks if an agent has permission to perform a specific action.
 * Admins/Managers always have permission.
 */
export function canPerformAction(
  agent: {
    role: string;
    permission: {
      canTransferConversation?: boolean;
      canCloseConversation?: boolean;
      canDeleteConversation?: boolean;
      canManageQuickMessages?: boolean;
    } | null;
  },
  action: "transfer" | "close" | "delete" | "manage_quick_messages"
): boolean {
  if (agent.role === "ADMIN" || agent.role === "MANAGER") return true;
  if (!agent.permission) return false;
  const map: Record<typeof action, keyof typeof agent.permission> = {
    transfer: "canTransferConversation",
    close: "canCloseConversation",
    delete: "canDeleteConversation",
    manage_quick_messages: "canManageQuickMessages",
  };
  return (agent.permission[map[action]] ?? false) as boolean;
}
