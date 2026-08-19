/**
 * Testes focados das rotas de comentários de Activity.
 * Sem DB: mocka auth, activities, task-visibility e activity-comments.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authenticateApiRequest,
  runWithApiUserContext,
  getActivityById,
  canAccessActivity,
  createActivityComment,
  updateActivityComment,
  softDeleteActivityComment,
  listActivityCommentHistory,
  listCommentRevisions,
} = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  runWithApiUserContext: vi.fn(async (_user: unknown, fn: () => unknown) => fn()),
  getActivityById: vi.fn(),
  canAccessActivity: vi.fn(),
  createActivityComment: vi.fn(),
  updateActivityComment: vi.fn(),
  softDeleteActivityComment: vi.fn(),
  listActivityCommentHistory: vi.fn(),
  listCommentRevisions: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest,
  runWithApiUserContext,
}));

vi.mock("@/services/activities", () => ({
  getActivityById,
}));

vi.mock("@/services/task-visibility", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/task-visibility")>();
  return {
    ...actual,
    canAccessActivity,
  };
});

vi.mock("@/services/activity-comments", () => ({
  COMMENT_CONTENT_MAX: 10_000,
  createActivityComment,
  updateActivityComment,
  softDeleteActivityComment,
  listActivityComments: vi.fn(),
  listActivityCommentHistory,
  listCommentRevisions,
}));

const AUTH_USER = {
  id: "auth_user",
  name: "Auth User",
  email: "auth@example.com",
  organizationId: "org_1",
  role: "MEMBER",
  isSuperAdmin: false,
};

const ACTIVITY = {
  id: "act_1",
  title: "Tarefa",
  dealId: "deal_1",
  contactId: "contact_1",
  userId: "auth_user",
  departmentId: null,
};

function authOk() {
  authenticateApiRequest.mockResolvedValue({ ok: true, user: AUTH_USER });
}

beforeEach(() => {
  vi.clearAllMocks();
  runWithApiUserContext.mockImplementation(async (_user: unknown, fn: () => unknown) => fn());
  authOk();
  getActivityById.mockResolvedValue(ACTIVITY);
  canAccessActivity.mockResolvedValue(true);
});

describe("POST /api/activities/[id]/comments", () => {
  it("ignora authorId do body e usa o usuário autenticado; gated por canAccessActivity", async () => {
    createActivityComment.mockResolvedValue({
      id: "c1",
      authorId: AUTH_USER.id,
      content: "oi",
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/activities/act_1/comments", {
      method: "POST",
      body: JSON.stringify({
        content: "oi",
        authorId: "fake_author",
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "act_1" }) });

    expect(res.status).toBe(201);
    expect(canAccessActivity).toHaveBeenCalled();
    expect(createActivityComment).toHaveBeenCalledTimes(1);
    const arg = createActivityComment.mock.calls[0][0] as {
      authorId: string;
      content: string;
      activityId: string;
    };
    expect(arg.authorId).toBe("auth_user");
    expect(arg.authorId).not.toBe("fake_author");
    expect(arg.content).toBe("oi");
    expect(arg.activityId).toBe("act_1");
  });

  it("404 quando viewer não acessa a Activity", async () => {
    canAccessActivity.mockResolvedValue(false);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/activities/act_1/comments", {
      method: "POST",
      body: JSON.stringify({ content: "oi" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "act_1" }) });

    expect(res.status).toBe(404);
    expect(createActivityComment).not.toHaveBeenCalled();
  });
});

describe("GET /api/activities/[id]/comments?history=1", () => {
  it("404 quando acesso à Activity é negado", async () => {
    canAccessActivity.mockResolvedValue(false);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/activities/act_1/comments?history=1");
    const res = await GET(req, { params: Promise.resolve({ id: "act_1" }) });

    expect(res.status).toBe(404);
    expect(listActivityCommentHistory).not.toHaveBeenCalled();
  });

  it("403 quando operador (MEMBER) tenta ver o histórico", async () => {
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/activities/act_1/comments?history=1");
    const res = await GET(req, { params: Promise.resolve({ id: "act_1" }) });

    expect(res.status).toBe(403);
    expect(listActivityCommentHistory).not.toHaveBeenCalled();
  });

  it("lista histórico para ADMIN", async () => {
    authenticateApiRequest.mockResolvedValue({
      ok: true,
      user: { ...AUTH_USER, role: "ADMIN" },
    });
    listActivityCommentHistory.mockResolvedValue([]);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/activities/act_1/comments?history=1");
    const res = await GET(req, { params: Promise.resolve({ id: "act_1" }) });

    expect(res.status).toBe(200);
    expect(listActivityCommentHistory).toHaveBeenCalledWith("act_1");
  });
});

describe("PUT /api/activities/[id]/comments/[commentId]", () => {
  it("403 quando service lança FORBIDDEN_NOT_AUTHOR", async () => {
    updateActivityComment.mockRejectedValue(new Error("FORBIDDEN_NOT_AUTHOR"));

    const { PUT } = await import("./[commentId]/route");
    const req = new Request("http://localhost/api/activities/act_1/comments/c1", {
      method: "PUT",
      body: JSON.stringify({ content: "hack" }),
    });
    const res = await PUT(req, {
      params: Promise.resolve({ id: "act_1", commentId: "c1" }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/autor/i);
  });
});

describe("DELETE /api/activities/[id]/comments/[commentId]", () => {
  it("403 quando service lança FORBIDDEN_NOT_AUTHOR", async () => {
    softDeleteActivityComment.mockRejectedValue(new Error("FORBIDDEN_NOT_AUTHOR"));

    const { DELETE } = await import("./[commentId]/route");
    const req = new Request("http://localhost/api/activities/act_1/comments/c1", {
      method: "DELETE",
    });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: "act_1", commentId: "c1" }),
    });

    expect(res.status).toBe(403);
  });
});

describe("GET /api/activities/[id]/comments/[commentId]/revisions", () => {
  it("404 quando acesso à Activity é negado", async () => {
    canAccessActivity.mockResolvedValue(false);

    const { GET } = await import("./[commentId]/revisions/route");
    const req = new Request("http://localhost/api/activities/act_1/comments/c1/revisions");
    const res = await GET(req, {
      params: Promise.resolve({ id: "act_1", commentId: "c1" }),
    });

    expect(res.status).toBe(404);
    expect(listCommentRevisions).not.toHaveBeenCalled();
  });

  it("403 quando operador tenta ver revisões", async () => {
    const { GET } = await import("./[commentId]/revisions/route");
    const req = new Request("http://localhost/api/activities/act_1/comments/c1/revisions");
    const res = await GET(req, {
      params: Promise.resolve({ id: "act_1", commentId: "c1" }),
    });

    expect(res.status).toBe(403);
    expect(listCommentRevisions).not.toHaveBeenCalled();
  });
});
