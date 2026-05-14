import type { ConversationStatus, Prisma } from "@prisma/client";

import type { AppUserRole } from "@/lib/auth-types";
import { userHasConversationAccess } from "@/lib/conversation-access";
import { canRoleSelfAssign } from "@/lib/self-assign";
import { prettifyChatMessageBody } from "@/lib/whatsapp-outbound-template-label";
import { prisma } from "@/lib/prisma";
import { getOrgIdOrThrow } from "@/lib/request-context";
import { enrichContactsWithUserAvatarFallback } from "@/lib/contact-avatar-fallback";

/** Abas de categoria (filtro OR em "Todos" para membros com escopo limitado). */
export const INBOX_CATEGORY_TABS = [
  "entrada",
  "esperando",
  "respondidas",
  "automacao",
  "finalizados",
  "erro",
] as const;

export type InboxCategoryTab = (typeof INBOX_CATEGORY_TABS)[number];
export type InboxTab = InboxCategoryTab | "todos";

export type GetConversationsParams = {
  contactId?: string;
  status?: ConversationStatus;
  channel?: string;
  tab?: InboxTab;
  /**
   * Com `tab: "todos"` e papel MEMBER: OR destas categorias (só o que o
   * utilizador pode ver). Omitir para ADMIN/MANAGER (todas as conversas
   * visíveis, só `visibilityWhere`).
   */
  todosCategoryTabs?: InboxCategoryTab[];
  /** Busca global: nome/telefone do contato, inboxName, responsável. Ignora filtro de aba. */
  search?: string;
  page?: number;
  perPage?: number;
  visibilityWhere?: Prisma.ConversationWhereInput;
  ownerId?: string;
  stageId?: string;
  tagIds?: string[];
  sortBy?: "updatedAt" | "createdAt" | "unreadCount";
  sortOrder?: "asc" | "desc";
};

const listInclude = {
  contact: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      avatarUrl: true,
    },
  },
} satisfies Prisma.ConversationInclude;

const listSelect = {
  id: true,
  externalId: true,
  channel: true,
  status: true,
  inboxName: true,
  unreadCount: true,
  hasError: true,
  lastInboundAt: true,
  lastMessageDirection: true,
  updatedAt: true,
  createdAt: true,
  assignedToId: true,
  assignedTo: {
    select: { id: true, name: true, email: true, avatarUrl: true },
  },
  contact: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      avatarUrl: true,
      tags: {
        select: {
          tag: { select: { id: true, name: true, color: true } },
        },
      },
      deals: {
        where: { status: "OPEN" },
        select: {
          id: true,
          tags: {
            select: {
              tag: { select: { id: true, name: true, color: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ConversationSelect;

export type ConversationLastMessagePreview = {
  content: string;
  messageType: string;
  mediaUrl: string | null;
  direction: string;
};

export type ConversationTag = {
  id: string;
  name: string;
  color: string;
};

export type ConversationListItem = Prisma.ConversationGetPayload<{
  select: typeof listSelect;
}> & {
  lastMessagePreview: ConversationLastMessagePreview | null;
  lastMessageAt: Date | null;
  tags: ConversationTag[];
};

async function lastInboundBatch(
  conversationIds: string[]
): Promise<Map<string, Date>> {
  if (conversationIds.length === 0) return new Map();
  const orgId = getOrgIdOrThrow();
  const rows = await prisma.$queryRaw<{ conversationId: string; lastIn: Date }[]>`
    SELECT "conversationId", MAX("createdAt") AS "lastIn"
    FROM "messages"
    WHERE "conversationId" = ANY(${conversationIds})
      AND "direction" = 'in'
      AND "organizationId" = ${orgId}
    GROUP BY "conversationId"
  `;
  const map = new Map<string, Date>();
  for (const r of rows) {
    map.set(r.conversationId, r.lastIn);
  }
  return map;
}

async function lastMessagePreviewsBatch(
  conversationIds: string[]
): Promise<Map<string, { preview: ConversationLastMessagePreview; createdAt: Date }>> {
  if (conversationIds.length === 0) return new Map();
  const orgId = getOrgIdOrThrow();

  const rows = await prisma.$queryRaw<{
    conversationId: string;
    content: string;
    messageType: string;
    mediaUrl: string | null;
    direction: string;
    createdAt: Date;
  }[]>`
    SELECT DISTINCT ON ("conversationId")
      "conversationId", "content", "messageType", "mediaUrl", "direction", "createdAt"
    FROM "messages"
    WHERE "conversationId" = ANY(${conversationIds})
      AND "organizationId" = ${orgId}
    ORDER BY "conversationId", "createdAt" DESC
  `;

  const map = new Map<string, { preview: ConversationLastMessagePreview; createdAt: Date }>();
  for (const r of rows) {
    const text = prettifyChatMessageBody(r.content ?? "").trim();
    map.set(r.conversationId, {
      preview: {
        content: text.length > 140 ? `${text.slice(0, 137)}…` : text,
        messageType: r.messageType || "text",
        mediaUrl: r.mediaUrl ?? null,
        direction: r.direction || "in",
      },
      createdAt: r.createdAt,
    });
  }
  return map;
}

function tabToWhere(tab: InboxCategoryTab): Prisma.ConversationWhereInput {
  switch (tab) {
    case "entrada":
      return { status: "OPEN", hasAgentReply: false, hasError: false };
    case "esperando":
      return { status: "OPEN", hasAgentReply: true, lastMessageDirection: "in", hasError: false };
    case "respondidas":
      return { status: "OPEN", hasAgentReply: true, lastMessageDirection: "out", hasError: false };
    case "automacao":
      return {
        status: "OPEN",
        contact: {
          automationContexts: { some: { status: "RUNNING" } },
        },
      };
    case "finalizados":
      return { status: "RESOLVED" };
    case "erro":
      return { hasError: true };
  }
}

export async function getConversations(
  params: GetConversationsParams = {}
): Promise<{
  items: ConversationListItem[];
  total: number;
  page: number;
  perPage: number;
}> {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(100, Math.max(1, params.perPage ?? 20));
  const skip = (page - 1) * perPage;

  const conditions: Prisma.ConversationWhereInput[] = [];

  if (params.visibilityWhere && Object.keys(params.visibilityWhere).length > 0) {
    conditions.push(params.visibilityWhere);
  }

  const q = params.search?.trim() ?? "";
  if (q.length > 0) {
    conditions.push({
      OR: [
        { contact: { name: { contains: q, mode: "insensitive" } } },
        { contact: { phone: { contains: q, mode: "insensitive" } } },
        { inboxName: { contains: q, mode: "insensitive" } },
        { assignedTo: { name: { contains: q, mode: "insensitive" } } },
        { assignedTo: { email: { contains: q, mode: "insensitive" } } },
      ],
    });
  } else if (params.tab) {
    if (params.tab === "todos") {
      const orTabs = params.todosCategoryTabs;
      if (orTabs && orTabs.length > 0) {
        conditions.push({ OR: orTabs.map((t) => tabToWhere(t)) });
      }
    } else {
      conditions.push(tabToWhere(params.tab));
    }
  }
  if (params.contactId) conditions.push({ contactId: params.contactId });
  if (params.status && !params.tab) conditions.push({ status: params.status });
  if (params.channel) conditions.push({ channel: params.channel });

  if (params.ownerId) {
    conditions.push({
      OR: [
        { assignedToId: params.ownerId },
        {
          contact: {
            OR: [
              { deals: { some: { ownerId: params.ownerId } } },
              { assignedToId: params.ownerId },
            ],
          },
        },
      ],
    });
  }
  if (params.stageId) {
    conditions.push({
      contact: { deals: { some: { stageId: params.stageId } } },
    });
  }
  if (params.tagIds && params.tagIds.length > 0) {
    conditions.push({
      contact: { tags: { some: { tagId: { in: params.tagIds } } } },
    });
  }

  const where: Prisma.ConversationWhereInput =
    conditions.length > 0 ? { AND: conditions } : {};

  const sortBy = params.sortBy ?? "updatedAt";
  const sortOrder = params.sortOrder ?? "desc";
  const orderBy: Prisma.ConversationOrderByWithRelationInput = { [sortBy]: sortOrder };

  const [rows, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      skip,
      take: perPage,
      orderBy,
      select: listSelect,
    }),
    prisma.conversation.count({ where }),
  ]);

  const convIds = rows.map((r) => r.id);
  const [previewMap, lastInboundMap] = await Promise.all([
    lastMessagePreviewsBatch(convIds),
    lastInboundBatch(convIds),
  ]);

  await enrichContactsWithUserAvatarFallback(
    rows.map((r) => r.contact).filter((c): c is NonNullable<typeof c> => c !== null),
  );

  const items: ConversationListItem[] = rows.map((row) => {
    const tagMap = new Map<string, ConversationTag>();
    for (const t of row.contact?.tags ?? []) {
      if (t.tag) tagMap.set(t.tag.id, t.tag);
    }
    for (const deal of row.contact?.deals ?? []) {
      for (const t of deal.tags ?? []) {
        if (t.tag) tagMap.set(t.tag.id, t.tag);
      }
    }
    return {
      ...row,
      lastInboundAt: lastInboundMap.get(row.id) ?? row.lastInboundAt,
      lastMessagePreview: previewMap.get(row.id)?.preview ?? null,
      lastMessageAt: previewMap.get(row.id)?.createdAt ?? null,
      tags: Array.from(tagMap.values()),
    };
  });

  return { items, total, page, perPage };
}

/** Lista só categorias (exclui "todos") — contagens por aba e grants. */
export const INBOX_TAB_LIST: readonly InboxCategoryTab[] = INBOX_CATEGORY_TABS;

/** @deprecated use INBOX_TAB_LIST */
const TAB_LIST = INBOX_TAB_LIST;

async function countTodosTab(
  visibilityWhere: Prisma.ConversationWhereInput | undefined,
  memberOrTabs: InboxCategoryTab[] | null,
): Promise<number> {
  const conditions: Prisma.ConversationWhereInput[] = [];
  if (visibilityWhere && Object.keys(visibilityWhere).length > 0) {
    conditions.push(visibilityWhere);
  }
  if (memberOrTabs && memberOrTabs.length > 0) {
    conditions.push({ OR: memberOrTabs.map((t) => tabToWhere(t)) });
  }
  const where: Prisma.ConversationWhereInput =
    conditions.length > 0 ? { AND: conditions } : {};
  return prisma.conversation.count({ where });
}

export async function getTabCounts(
  visibilityWhere?: Prisma.ConversationWhereInput,
  /** `null` = ADMIN/MANAGER (todas as conversas visíveis). Array = MEMBER (OR das categorias). */
  todosMemberCategoryTabs?: InboxCategoryTab[] | null,
): Promise<Record<InboxTab, number>> {
  const results = await Promise.all(
    TAB_LIST.map(async (tab) => {
      const conditions: Prisma.ConversationWhereInput[] = [];
      if (visibilityWhere && Object.keys(visibilityWhere).length > 0) {
        conditions.push(visibilityWhere);
      }
      conditions.push(tabToWhere(tab));
      const where: Prisma.ConversationWhereInput =
        conditions.length > 0 ? { AND: conditions } : {};
      const count = await prisma.conversation.count({ where });
      return [tab, count] as const;
    }),
  );
  const record = Object.fromEntries(results) as Record<InboxTab, number>;
  record.todos = await countTodosTab(visibilityWhere, todosMemberCategoryTabs ?? null);
  return record;
}

export async function linkContactToConversation(conversationId: string, contactId: string) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { contactId },
    include: { contact: { select: { id: true, name: true, email: true, phone: true, avatarUrl: true } } },
  });
}

export async function getConversationById(id: string) {
  const conv = await prisma.conversation.findUnique({
    where: { id },
    include: {
      contact: { select: { id: true, name: true, email: true, phone: true, avatarUrl: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });
  if (conv?.contact) {
    await enrichContactsWithUserAvatarFallback([conv.contact]);
  }
  return conv;
}

export type AssignConversationResult =
  | { ok: true; conversation: NonNullable<Awaited<ReturnType<typeof getConversationById>>> }
  | { ok: false; code: "NOT_FOUND" | "FORBIDDEN" | "USER_NOT_FOUND" };

export async function assignConversationAssignedTo(
  conversationId: string,
  newAssigneeId: string | null,
  actor: { id: string; role: AppUserRole }
): Promise<AssignConversationResult> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { assignedToId: true },
  });
  if (!conv) return { ok: false, code: "NOT_FOUND" };

  const isAdmin = actor.role === "ADMIN";
  const isManager = actor.role === "MANAGER";
  const isAdminOrManager = isAdmin || isManager;

  if (!isAdminOrManager) {
    if (newAssigneeId === null) return { ok: false, code: "FORBIDDEN" };
    if (newAssigneeId !== actor.id) return { ok: false, code: "FORBIDDEN" };
    if (conv.assignedToId && conv.assignedToId !== actor.id) {
      return { ok: false, code: "FORBIDDEN" };
    }
    // Auto-atribuição requer permissão configurada pelo administrador.
    if (!conv.assignedToId) {
      const allowed = await canRoleSelfAssign(actor.role);
      if (!allowed) return { ok: false, code: "FORBIDDEN" };
      const ok = await userHasConversationAccess(actor, conversationId);
      if (!ok) return { ok: false, code: "FORBIDDEN" };
    }
  } else {
    // Managers também respeitam o flag quando estão se auto-atribuindo.
    if (!isAdmin && newAssigneeId === actor.id && !conv.assignedToId) {
      const allowed = await canRoleSelfAssign(actor.role);
      if (!allowed) return { ok: false, code: "FORBIDDEN" };
    }
    if (!isAdmin) {
      const ok = await userHasConversationAccess(actor, conversationId);
      if (!ok) return { ok: false, code: "FORBIDDEN" };
    }
    if (newAssigneeId !== null) {
      const u = await prisma.user.findUnique({
        where: { id: newAssigneeId },
        select: { id: true },
      });
      if (!u) return { ok: false, code: "USER_NOT_FOUND" };
    }
  }

  // Reset do flag de saudação do agente IA quando há troca real de
  // assignedToId — garante que a próxima reatribuição a um agente IA
  // dispare saudação de novo.
  const shouldResetGreeted = (conv.assignedToId ?? null) !== (newAssigneeId ?? null);

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      assignedToId: newAssigneeId,
      ...(shouldResetGreeted ? { aiGreetedAt: null } : {}),
    },
    include: {
      contact: { select: { id: true, name: true, email: true, phone: true, avatarUrl: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });

  return { ok: true, conversation: updated };
}

export async function getConversationLite(id: string) {
  return prisma.conversation.findUnique({
    where: { id },
    select: {
      id: true, externalId: true, contactId: true, status: true,
      channelId: true, waJid: true, organizationId: true,
      channelRef: { select: { id: true, provider: true, config: true } },
    },
  });
}

export async function updateConversationStatusInDb(id: string, status: ConversationStatus) {
  return prisma.conversation.update({
    where: { id },
    data: { status },
    include: { contact: { select: { id: true, name: true, email: true, phone: true, avatarUrl: true } } },
  });
}
