/**
 * Testes focados de ActivityComment (criar/editar/excluir + revisions).
 * Mock in-memory do Prisma; org scoping via request-context.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type CommentRow = {
  id: string;
  organizationId: string;
  activityId: string;
  authorId: string;
  content: string;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type RevisionRow = {
  id: string;
  organizationId: string;
  commentId: string;
  actorId: string;
  action: "CREATED" | "UPDATED" | "DELETED";
  beforeContent: string | null;
  afterContent: string | null;
  createdAt: Date;
};

const { store, prismaMock } = vi.hoisted(() => {
  const store: {
    comments: CommentRow[];
    revisions: RevisionRow[];
    events: Array<{ type: string; insideTx: boolean; data: Record<string, unknown> }>;
    seq: number;
    inTransaction: boolean;
  } = { comments: [], revisions: [], events: [], seq: 0, inTransaction: false };

  const authors: Record<string, { id: string; name: string; avatarUrl: string | null }> = {
    author_1: { id: "author_1", name: "Alice", avatarUrl: null },
    author_2: { id: "author_2", name: "Bob", avatarUrl: null },
  };

  const prismaMock: {
    $transaction: <T>(fn: (tx: typeof prismaMock) => Promise<T>) => Promise<T>;
    activityComment: {
      findMany: (args: {
        where: { activityId: string; organizationId: string };
        orderBy?: unknown;
        include?: unknown;
      }) => Promise<unknown[]>;
      findFirst: (args: {
        where: { id: string; activityId?: string; organizationId: string };
        select?: { id: true };
        include?: unknown;
      }) => Promise<unknown>;
      create: (args: { data: Record<string, unknown>; include?: unknown }) => Promise<unknown>;
      update: (args: {
        where: { id: string };
        data: Record<string, unknown>;
        include?: unknown;
      }) => Promise<unknown>;
    };
    activityCommentRevision: {
      create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
      findMany: (args: {
        where: Record<string, unknown>;
        orderBy?: unknown;
        include?: unknown;
      }) => Promise<unknown[]>;
    };
    activityEvent: {
      create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    };
  } = {
    async $transaction(fn) {
      store.inTransaction = true;
      try {
        return await fn(prismaMock);
      } finally {
        store.inTransaction = false;
      }
    },
    activityComment: {
      async findMany(args) {
        return store.comments
          .filter(
            (c) =>
              c.activityId === args.where.activityId &&
              c.organizationId === args.where.organizationId,
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((c) => ({ ...c, author: authors[c.authorId] ?? authors.author_1 }));
      },
      async findFirst(args) {
        const row = store.comments.find(
          (c) =>
            c.id === args.where.id &&
            c.organizationId === args.where.organizationId &&
            (args.where.activityId == null || c.activityId === args.where.activityId),
        );
        if (!row) return null;
        if (args.select?.id) return { id: row.id };
        return { ...row, author: authors[row.authorId] ?? authors.author_1 };
      },
      async create(args) {
        store.seq += 1;
        const now = new Date();
        const row: CommentRow = {
          id: `c_${store.seq}`,
          organizationId: String(args.data.organizationId),
          activityId: String(args.data.activityId),
          authorId: String(args.data.authorId),
          content: String(args.data.content),
          editedAt: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        store.comments.push(row);
        return { ...row, author: authors[row.authorId] ?? authors.author_1 };
      },
      async update(args) {
        const row = store.comments.find((c) => c.id === args.where.id);
        if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
        if (args.data.content !== undefined) row.content = String(args.data.content);
        if (args.data.editedAt !== undefined) row.editedAt = args.data.editedAt as Date;
        if (args.data.deletedAt !== undefined) row.deletedAt = args.data.deletedAt as Date | null;
        row.updatedAt = new Date();
        return { ...row, author: authors[row.authorId] ?? authors.author_1 };
      },
    },
    activityCommentRevision: {
      async create(args) {
        store.seq += 1;
        const row: RevisionRow = {
          id: `r_${store.seq}`,
          organizationId: String(args.data.organizationId),
          commentId: String(args.data.commentId),
          actorId: String(args.data.actorId),
          action: args.data.action as RevisionRow["action"],
          beforeContent: (args.data.beforeContent as string | null) ?? null,
          afterContent: (args.data.afterContent as string | null) ?? null,
          createdAt: new Date(),
        };
        store.revisions.push(row);
        return row;
      },
      async findMany(args) {
        const where = args.where as {
          organizationId: string;
          commentId?: string;
          comment?: { activityId: string; organizationId: string };
        };
        let filtered = store.revisions.filter((r) => r.organizationId === where.organizationId);
        if (where.commentId) {
          filtered = filtered.filter((r) => r.commentId === where.commentId);
        } else if (where.comment) {
          const activityId = where.comment.activityId;
          const commentIds = new Set(
            store.comments.filter((c) => c.activityId === activityId).map((c) => c.id),
          );
          filtered = filtered.filter((r) => commentIds.has(r.commentId));
        }
        return filtered
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((r) => ({ ...r, actor: authors[r.actorId] ?? authors.author_1 }));
      },
    },
    activityEvent: {
      async create(args) {
        store.events.push({
          type: String(args.data.type),
          insideTx: store.inTransaction,
          data: args.data,
        });
        return args.data;
      },
    },
  };

  return { store, prismaMock };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/request-context", () => ({
  getRequestContext: () => ({ organizationId: "org_1", userId: "author_1" }),
}));
vi.mock("@/lib/prisma-helpers", () => ({
  withOrgFromCtx: <T extends Record<string, unknown>>(data: T) => ({
    ...data,
    organizationId: "org_1",
  }),
}));
vi.mock("@/services/activity-log", () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/prisma-base", () => ({
  prismaBase: {
    departmentMember: {
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) =>
        where.userId === "dept_member" ? [{ departmentId: "dept_x" }] : [],
      ),
    },
  },
}));

import {
  createActivityComment,
  listCommentRevisions,
  softDeleteActivityComment,
  updateActivityComment,
} from "@/services/activity-comments";
import { canAccessActivity } from "@/services/task-visibility";

beforeEach(() => {
  store.comments = [];
  store.revisions = [];
  store.events = [];
  store.seq = 0;
  store.inTransaction = false;
});

describe("activity-comments service", () => {
  it("cria comentário com revision CREATED", async () => {
    const comment = await createActivityComment({
      activityId: "act_1",
      authorId: "author_1",
      content: "  Olá  ",
    });

    expect(comment.content).toBe("Olá");
    expect(comment.authorId).toBe("author_1");
    expect(comment.deletedAt).toBeNull();
    expect(store.revisions).toHaveLength(1);
    expect(store.revisions[0].action).toBe("CREATED");
    expect(store.revisions[0].afterContent).toBe("Olá");
    expect(store.revisions[0].beforeContent).toBeNull();
  });

  it("autor edita e gera revision UPDATED preservando before/after", async () => {
    const created = await createActivityComment({
      activityId: "act_1",
      authorId: "author_1",
      content: "v1",
    });

    const updated = await updateActivityComment({
      activityId: "act_1",
      commentId: created.id,
      actorId: "author_1",
      content: "v2",
    });

    expect(updated.content).toBe("v2");
    expect(updated.editedAt).not.toBeNull();
    const rev = store.revisions.find((r) => r.action === "UPDATED");
    expect(rev?.beforeContent).toBe("v1");
    expect(rev?.afterContent).toBe("v2");
  });

  it("terceiro recebe FORBIDDEN_NOT_AUTHOR ao editar", async () => {
    const created = await createActivityComment({
      activityId: "act_1",
      authorId: "author_1",
      content: "privado",
    });

    await expect(
      updateActivityComment({
        activityId: "act_1",
        commentId: created.id,
        actorId: "author_2",
        content: "hack",
      }),
    ).rejects.toThrow("FORBIDDEN_NOT_AUTHOR");

    expect(store.comments[0].content).toBe("privado");
  });

  it("soft-delete pelo autor preserva content no banco e revision DELETED", async () => {
    const created = await createActivityComment({
      activityId: "act_1",
      authorId: "author_1",
      content: "apagar",
    });

    const deleted = await softDeleteActivityComment({
      activityId: "act_1",
      commentId: created.id,
      actorId: "author_1",
    });

    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.content).toBeNull(); // DTO lista oculta conteúdo
    expect(store.comments[0].content).toBe("apagar"); // banco preserva
    expect(store.comments[0].deletedAt).not.toBeNull();

    const rev = store.revisions.find((r) => r.action === "DELETED");
    expect(rev?.beforeContent).toBe("apagar");
    expect(rev?.afterContent).toBeNull();

    const history = await listCommentRevisions({
      activityId: "act_1",
      commentId: created.id,
    });
    expect(history.map((h) => h.action)).toEqual(["CREATED", "DELETED"]);
    expect(history[1].beforeContent).toBe("apagar");
  });

  it("terceiro não consegue soft-delete", async () => {
    const created = await createActivityComment({
      activityId: "act_1",
      authorId: "author_1",
      content: "x",
    });

    await expect(
      softDeleteActivityComment({
        activityId: "act_1",
        commentId: created.id,
        actorId: "author_2",
      }),
    ).rejects.toThrow("FORBIDDEN_NOT_AUTHOR");
  });

  it("grava ActivityEvent ADDED/UPDATED/DELETED dentro de $transaction", async () => {
    store.events = [];

    const created = await createActivityComment({
      activityId: "act_1",
      authorId: "author_1",
      content: "v1",
    });
    await updateActivityComment({
      activityId: "act_1",
      commentId: created.id,
      actorId: "author_1",
      content: "v2",
    });
    await softDeleteActivityComment({
      activityId: "act_1",
      commentId: created.id,
      actorId: "author_1",
    });

    expect(store.events.map((e) => e.type)).toEqual([
      "ACTIVITY_COMMENT_ADDED",
      "ACTIVITY_COMMENT_UPDATED",
      "ACTIVITY_COMMENT_DELETED",
    ]);
    expect(store.events.every((e) => e.insideTx)).toBe(true);
  });
});

describe("canAccessActivity gate", () => {
  it("assignee e ADMIN acessam; estranho sem depto não", async () => {
    const okOwn = await canAccessActivity(
      { id: "u1", organizationId: "org_1", role: "MEMBER" },
      { userId: "u1", departmentId: null },
    );
    expect(okOwn).toBe(true);

    const adminOk = await canAccessActivity(
      { id: "admin", organizationId: "org_1", role: "ADMIN" },
      { userId: "other", departmentId: "dept_x" },
    );
    expect(adminOk).toBe(true);

    const stranger = await canAccessActivity(
      { id: "u2", organizationId: "org_1", role: "MEMBER" },
      { userId: "u1", departmentId: null },
    );
    expect(stranger).toBe(false);

    const departmentMember = await canAccessActivity(
      { id: "dept_member", organizationId: "org_1", role: "MEMBER" },
      { userId: null, departmentId: "dept_x" },
    );
    expect(departmentMember).toBe(true);
  });
});
