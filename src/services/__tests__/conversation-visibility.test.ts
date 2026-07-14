import { describe, expect, it } from "vitest";
import {
  buildConversationVisibilityWhere,
  canPerformAction,
  type AgentVisibilityContext,
} from "../conversation-visibility";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(
  overrides: Partial<AgentVisibilityContext> = {}
): AgentVisibilityContext {
  return {
    id: "agent-1",
    role: "AGENT",
    permission: {
      canViewOtherAgentsConversations: false,
      disableConversationsWithoutAgent: false,
      allowedDepartmentIds: [],
      allowedConnectionIds: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildConversationVisibilityWhere
// ---------------------------------------------------------------------------

describe("buildConversationVisibilityWhere", () => {
  it("admin sees everything — returns {}", () => {
    const result = buildConversationVisibilityWhere(
      makeAgent({ role: "ADMIN" })
    );
    expect(result).toEqual({});
  });

  it("manager sees everything — returns {}", () => {
    const result = buildConversationVisibilityWhere(
      makeAgent({ role: "MANAGER" })
    );
    expect(result).toEqual({});
  });

  it("agent without canViewOtherAgentsConversations — OR includes own id and null assignedToId", () => {
    const result = buildConversationVisibilityWhere(
      makeAgent({
        id: "agent-42",
        permission: {
          canViewOtherAgentsConversations: false,
          disableConversationsWithoutAgent: false,
          allowedDepartmentIds: [],
          allowedConnectionIds: [],
        },
      })
    );
    expect(result).toEqual({
      OR: [{ assignedToId: "agent-42" }, { assignedToId: null }],
    });
  });

  it("agent with disableConversationsWithoutAgent=true — OR includes ONLY own id", () => {
    const result = buildConversationVisibilityWhere(
      makeAgent({
        id: "agent-7",
        permission: {
          canViewOtherAgentsConversations: false,
          disableConversationsWithoutAgent: true,
          allowedDepartmentIds: [],
          allowedConnectionIds: [],
        },
      })
    );
    expect(result).toEqual({
      OR: [{ assignedToId: "agent-7" }],
    });
  });

  it("agent with canViewOtherAgentsConversations=true, no scopes — returns {}", () => {
    const result = buildConversationVisibilityWhere(
      makeAgent({
        permission: {
          canViewOtherAgentsConversations: true,
          disableConversationsWithoutAgent: false,
          allowedDepartmentIds: [],
          allowedConnectionIds: [],
        },
      })
    );
    expect(result).toEqual({});
  });

  it("department scope — where includes departmentId: { in: [...] }", () => {
    const result = buildConversationVisibilityWhere(
      makeAgent({
        id: "agent-1",
        permission: {
          canViewOtherAgentsConversations: false,
          disableConversationsWithoutAgent: false,
          allowedDepartmentIds: ["dept-a", "dept-b"],
          allowedConnectionIds: [],
        },
      })
    );
    expect(result).toMatchObject({
      departmentId: { in: ["dept-a", "dept-b"] },
    });
    expect(result).toHaveProperty("OR");
  });

  it("connection scope — where includes channelId: { in: [...] }", () => {
    const result = buildConversationVisibilityWhere(
      makeAgent({
        id: "agent-1",
        permission: {
          canViewOtherAgentsConversations: false,
          disableConversationsWithoutAgent: false,
          allowedDepartmentIds: [],
          allowedConnectionIds: ["conn-1", "conn-2"],
        },
      })
    );
    expect(result).toMatchObject({
      channelId: { in: ["conn-1", "conn-2"] },
    });
    expect(result).toHaveProperty("OR");
  });
});

// ---------------------------------------------------------------------------
// canPerformAction
// ---------------------------------------------------------------------------

describe("canPerformAction", () => {
  it("admin has all permissions", () => {
    const agent = { role: "ADMIN", permission: null };
    expect(canPerformAction(agent, "transfer")).toBe(true);
    expect(canPerformAction(agent, "close")).toBe(true);
    expect(canPerformAction(agent, "delete")).toBe(true);
    expect(canPerformAction(agent, "manage_quick_messages")).toBe(true);
  });

  it("manager has all permissions", () => {
    const agent = { role: "MANAGER", permission: null };
    expect(canPerformAction(agent, "transfer")).toBe(true);
    expect(canPerformAction(agent, "close")).toBe(true);
    expect(canPerformAction(agent, "delete")).toBe(true);
    expect(canPerformAction(agent, "manage_quick_messages")).toBe(true);
  });

  it("agent with no permission record returns false for all actions", () => {
    const agent = { role: "AGENT", permission: null };
    expect(canPerformAction(agent, "transfer")).toBe(false);
    expect(canPerformAction(agent, "close")).toBe(false);
    expect(canPerformAction(agent, "delete")).toBe(false);
    expect(canPerformAction(agent, "manage_quick_messages")).toBe(false);
  });

  it("agent with canTransfer=false, canClose=true returns correct booleans", () => {
    const agent = {
      role: "AGENT",
      permission: {
        canTransferConversation: false,
        canCloseConversation: true,
        canDeleteConversation: false,
        canManageQuickMessages: false,
      },
    };
    expect(canPerformAction(agent, "transfer")).toBe(false);
    expect(canPerformAction(agent, "close")).toBe(true);
    expect(canPerformAction(agent, "delete")).toBe(false);
    expect(canPerformAction(agent, "manage_quick_messages")).toBe(false);
  });
});
