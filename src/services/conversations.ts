import type { ConversationStatus, Prisma } from "@prisma/client";

import type { AppUserRole } from "@/lib/auth-types";
import { userHasConversationAccess } from "@/lib/conversation-access";
import { canRoleSelfAssign } from "@/lib/self-assign";
import { prettifyChatMessageBody } from "@/lib/whatsapp-outbound-template-label";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { getOrgIdOrThrow } from "@/lib/request-context";
import { enrichContactsWithUserAvatarFallback } from "@/lib/contact-avatar-fallback";
import { SOURCE_NONE } from "@/services/kanban-filters";

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
/**
 * `abertas` = TODAS as conversas em aberto (status OPEN), sem subdividir por
 * categoria e excluindo as Resolvidas. Igual a `todos`, é um "super-tab" e não
 * uma categoria (não entra em `INBOX_CATEGORY_TABS`).
 */
export type InboxTab = InboxCategoryTab | "todos" | "abertas";

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
  /** true = só conversas sem responsável (`assignedToId` null). */
  withoutOwner?: boolean;
  stageId?: string;
  tagIds?: string[];
  /** Origens do contato (Contact.source). Pode incluir `SOURCE_NONE`. */
  sources?: string[];
  /** true = só conversas cujo contato não tem origem. */
  withoutSource?: boolean;
  sortBy?: "updatedAt" | "createdAt" | "unreadCount";
  sortOrder?: "asc" | "desc";
  /**
   * Escopo de canais por usuário (IDs de `Channel`). `null/undefined` → sem
   * restrição; array (mesmo vazio) → restringe conversas a esses canais.
   */
  allowedChannelIds?: string[] | null;
};

const listSelect = {
  id: true,
  number: true,
  externalId: true,
  channel: true,
  status: true,
  inboxName: true,
  unreadCount: true,
  hasError: true,
  lastInboundAt: true,
  lastMessageDirection: true,
  closedAt: true,
  updatedAt: true,
  createdAt: true,
  assignedToId: true,
  departmentId: true,
  department: { select: { id: true, name: true, requireTabulationOnClose: true } },
  tabulationId: true,
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
      // `deals.tags` removido: o card/header usa só tags do contato.
      // Tags do negócio vêm pelo detalhe do deal quando necessário.
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
  // Janela de 24h e' do CONTATO (regra da Meta), nao do ticket: um ticket
  // recem-aberto (reopen/resposta pos-encerramento) nasce sem inbound, mas
  // o cliente pode ter escrito minutos atras no ticket anterior. Agrega o
  // ultimo inbound de QUALQUER conversa do mesmo contato+canal.
  const rows = await prisma.$queryRaw<{ conversationId: string; lastIn: Date }[]>`
    SELECT c."id" AS "conversationId", MAX(m."createdAt") AS "lastIn"
    FROM "conversations" c
    JOIN "conversations" c2
      ON c2."contactId" = c."contactId"
     AND c2."channel" = c."channel"
     AND c2."organizationId" = c."organizationId"
    JOIN "messages" m
      ON m."conversationId" = c2."id"
     AND m."direction" = 'in'
    WHERE c."id" = ANY(${conversationIds})
      AND c."organizationId" = ${orgId}
    GROUP BY c."id"
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

function buildConversationSourceCondition(
  sources?: string[],
  withoutSource?: boolean,
): Prisma.ConversationWhereInput | null {
  const real = (sources ?? []).filter((s) => s && s !== SOURCE_NONE);
  const wantNone = withoutSource === true || (sources ?? []).includes(SOURCE_NONE);
  const or: Prisma.ConversationWhereInput[] = [];
  if (real.length) or.push({ contact: { source: { in: real } } });
  if (wantNone) {
    or.push({
      OR: [
        { contactId: null },
        { contact: { is: { source: null } } },
        { contact: { is: { source: "" } } },
      ],
    });
  }
  if (or.length === 0) return null;
  return or.length === 1 ? or[0] : { OR: or };
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

/**
 * Monta o `where` da listagem de conversas (visibilidade + busca/aba +
 * filtros). Extraído de `getConversations` para ser reaproveitado pelo
 * encerramento em massa "por filtro" (`getResolvableConversationIds`),
 * garantindo que a seleção "todas do filtro" case exatamente com a lista.
 */
export function buildConversationListWhere(
  params: GetConversationsParams,
): Prisma.ConversationWhereInput {
  const conditions: Prisma.ConversationWhereInput[] = [];

  if (params.visibilityWhere && Object.keys(params.visibilityWhere).length > 0) {
    conditions.push(params.visibilityWhere);
  }

  const q = params.search?.trim() ?? "";
  if (q.length > 0) {
    const or: Prisma.ConversationWhereInput[] = [
      { contact: { name: { contains: q, mode: "insensitive" } } },
      { contact: { phone: { contains: q, mode: "insensitive" } } },
      { contact: { email: { contains: q, mode: "insensitive" } } },
      { contact: { whatsappUsername: { contains: q, mode: "insensitive" } } },
      { contact: { source: { contains: q, mode: "insensitive" } } },
      { contact: { company: { name: { contains: q, mode: "insensitive" } } } },
      { contact: { customFields: { some: { value: { contains: q, mode: "insensitive" } } } } },
      { contact: { deals: { some: { title: { contains: q, mode: "insensitive" } } } } },
      { inboxName: { contains: q, mode: "insensitive" } },
      { assignedTo: { name: { contains: q, mode: "insensitive" } } },
      { assignedTo: { email: { contains: q, mode: "insensitive" } } },
    ];
    // Busca pelo #número do ticket ("1234" ou "#1234") — match exato,
    // usa o índice @@unique([organizationId, number]) (rápido).
    const numeric = q.replace(/^#/, "");
    if (/^\d+$/.test(numeric)) {
      const n = Number(numeric);
      if (Number.isSafeInteger(n)) or.push({ number: n });
    }
    conditions.push({ OR: or });
  } else if (params.tab) {
    if (params.tab === "todos") {
      const orTabs = params.todosCategoryTabs;
      if (orTabs && orTabs.length > 0) {
        conditions.push({ OR: orTabs.map((t) => tabToWhere(t)) });
      }
    } else if (params.tab === "abertas") {
      conditions.push({ status: "OPEN" });
    } else {
      conditions.push(tabToWhere(params.tab));
    }
  }
  if (params.contactId) conditions.push({ contactId: params.contactId });
  if (params.status && !params.tab) conditions.push({ status: params.status });
  if (params.channel) conditions.push({ channel: params.channel });
  if (params.allowedChannelIds) {
    conditions.push({ channelId: { in: params.allowedChannelIds } });
  }

  if (params.withoutOwner) {
    conditions.push({ assignedToId: null });
  } else if (params.ownerId) {
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
  const sourceCond = buildConversationSourceCondition(
    params.sources,
    params.withoutSource,
  );
  if (sourceCond) conditions.push(sourceCond);

  return conditions.length > 0 ? { AND: conditions } : {};
}

/**
 * IDs das conversas ENCERRÁVEIS que casam com um filtro de listagem — usado
 * pelo "selecionar todas do filtro → Encerrar". Aplica o MESMO `where` da
 * lista, mas restringe a `status != RESOLVED` (já resolvidas são no-op) e
 * separa as que estão em departamento com tabulação obrigatória no
 * encerramento (`requireTabulationOnClose`), que NÃO podem ser encerradas em
 * massa (precisam de tabulação individual).
 */
export async function getResolvableConversationIds(
  params: GetConversationsParams,
): Promise<{ ids: string[]; skippedIds: string[] }> {
  const baseWhere = buildConversationListWhere(params);
  const openWhere: Prisma.ConversationWhereInput = {
    AND: [baseWhere, { status: { not: "RESOLVED" } }],
  };

  const rows = await prisma.conversation.findMany({
    where: openWhere,
    select: {
      id: true,
      department: { select: { requireTabulationOnClose: true } },
    },
  });

  const ids: string[] = [];
  const skippedIds: string[] = [];
  for (const r of rows) {
    if (r.department?.requireTabulationOnClose) skippedIds.push(r.id);
    else ids.push(r.id);
  }
  return { ids, skippedIds };
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
  // 27/mai/26 — Cap subido de 100 → 200 pra acomodar o infinite scroll
  // da lista de conversas (operador com 455+ conversas em "Entrada"
  // travava porque o front pedia 60 e nunca pedia mais).
  const perPage = Math.min(200, Math.max(1, params.perPage ?? 20));
  const skip = (page - 1) * perPage;

  const where = buildConversationListWhere(params);

  const sortBy = params.sortBy ?? "updatedAt";
  const sortOrder = params.sortOrder ?? "desc";
  const orderBy: Prisma.ConversationOrderByWithRelationInput = { [sortBy]: sortOrder };

  // Colapso por CONTATO+CANAL (1 card por numero — modelo de ticket).
  // Reabrir uma conversa encerrada gera um NOVO id (ticket B); o ticket A
  // (RESOLVED) nao pode aparecer como um segundo card do mesmo numero. Como
  // os filtros dinamicos (tab/visibilidade/tags/sources/busca) sao objetos
  // Prisma complexos, evitamos traduzir tudo pra SQL cru: buscamos os IDs
  // que casam com o `where` NA ORDEM pedida (payload minimo) e colapsamos
  // em memoria pegando o REPRESENTANTE = primeiro da ordem por grupo. Com
  // `orderBy` = updatedAt desc (default), o primeiro e' o ticket ativo/mais
  // recente (os RESOLVED antigos ficam congelados, pois qualquer nova msg
  // reabre como ticket novo). Historico dos tickets antigos segue acessivel
  // na timeline continua do chat. Paginamos a lista colapsada e hidratamos
  // so a pagina com o `listSelect` completo. Ver frontend use-conversations.
  const keyRows = await prisma.conversation.findMany({
    where,
    orderBy,
    select: { id: true, contactId: true, channel: true },
  });

  // Quando a listagem e' de UM contato especifico (ex.: abas de ticket do
  // painel de negocio), NAO colapsa — o caller quer todos os tickets.
  const collapse = !params.contactId;
  const seenGroups = new Set<string>();
  const repIds: string[] = [];
  for (const r of keyRows) {
    const groupKey =
      collapse && r.contactId
        ? `c:${r.contactId}::${r.channel ?? ""}`
        : `id:${r.id}`;
    if (seenGroups.has(groupKey)) continue;
    seenGroups.add(groupKey);
    repIds.push(r.id);
  }

  const total = repIds.length;
  const pageIds = repIds.slice(skip, skip + perPage);

  const hydrated = await prisma.conversation.findMany({
    where: { id: { in: pageIds } },
    select: listSelect,
  });
  // Reordena para preservar a ordem paginada de `pageIds` (o `in` nao
  // garante ordem). Evita cards "pulando" de posicao entre paginas.
  const byIdRow = new Map(hydrated.map((r) => [r.id, r]));
  const rows = pageIds
    .map((id) => byIdRow.get(id))
    .filter((r): r is (typeof hydrated)[number] => r !== undefined);

  const convIds = rows.map((r) => r.id);
  const [previewMap, lastInboundMap] = await Promise.all([
    lastMessagePreviewsBatch(convIds),
    lastInboundBatch(convIds),
  ]);

  await enrichContactsWithUserAvatarFallback(
    rows.map((r) => r.contact).filter((c): c is NonNullable<typeof c> => c !== null),
  );

  const items: ConversationListItem[] = rows.map((row) => {
    // `tags` do card/header da conversa = tags do CONTATO apenas.
    // Antes mesclávamos tags do negócio aqui, o que fazia o header do
    // chat exibir badge derivada de tag de deal (ex.: "ENTERPRISE") —
    // pedido do operador: o header reflete a tag do contato, não do
    // negócio. Tags do negócio continuam disponíveis na seção de deal
    // do aside (via detalhe do deal), não neste array agregado.
    const tagMap = new Map<string, ConversationTag>();
    for (const t of row.contact?.tags ?? []) {
      if (t.tag) tagMap.set(t.tag.id, t.tag);
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
  allowedChannelIds?: string[] | null,
): Promise<number> {
  const conditions: Prisma.ConversationWhereInput[] = [];
  if (visibilityWhere && Object.keys(visibilityWhere).length > 0) {
    conditions.push(visibilityWhere);
  }
  if (memberOrTabs && memberOrTabs.length > 0) {
    conditions.push({ OR: memberOrTabs.map((t) => tabToWhere(t)) });
  }
  if (allowedChannelIds) {
    conditions.push({ channelId: { in: allowedChannelIds } });
  }
  const where: Prisma.ConversationWhereInput =
    conditions.length > 0 ? { AND: conditions } : {};
  return prisma.conversation.count({ where });
}

export async function getTabCounts(
  visibilityWhere?: Prisma.ConversationWhereInput,
  /** `null` = ADMIN/MANAGER (todas as conversas visíveis). Array = MEMBER (OR das categorias). */
  todosMemberCategoryTabs?: InboxCategoryTab[] | null,
  /** Escopo de canais por usuário (IDs de `Channel`). `null` = sem restrição. */
  allowedChannelIds?: string[] | null,
): Promise<Record<InboxTab, number>> {
  const results = await Promise.all(
    TAB_LIST.map(async (tab) => {
      const conditions: Prisma.ConversationWhereInput[] = [];
      if (visibilityWhere && Object.keys(visibilityWhere).length > 0) {
        conditions.push(visibilityWhere);
      }
      conditions.push(tabToWhere(tab));
      if (allowedChannelIds) {
        conditions.push({ channelId: { in: allowedChannelIds } });
      }
      const where: Prisma.ConversationWhereInput =
        conditions.length > 0 ? { AND: conditions } : {};
      const count = await prisma.conversation.count({ where });
      return [tab, count] as const;
    }),
  );
  const record = Object.fromEntries(results) as Record<InboxTab, number>;
  record.todos = await countTodosTab(
    visibilityWhere,
    todosMemberCategoryTabs ?? null,
    allowedChannelIds,
  );
  // "abertas" = todas as conversas em aberto (status OPEN), independentemente
  // da subcategoria. Contagem própria (não é uma categoria em TAB_LIST).
  {
    const conditions: Prisma.ConversationWhereInput[] = [];
    if (visibilityWhere && Object.keys(visibilityWhere).length > 0) {
      conditions.push(visibilityWhere);
    }
    conditions.push({ status: "OPEN" });
    if (allowedChannelIds) conditions.push({ channelId: { in: allowedChannelIds } });
    record.abertas = await prisma.conversation.count({
      where: conditions.length > 0 ? { AND: conditions } : {},
    });
  }
  return record;
}

export async function linkContactToConversation(conversationId: string, contactId: string) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { contactId },
    include: { contact: { select: { id: true, number: true, name: true, email: true, phone: true, avatarUrl: true } } },
  });
}

export async function getConversationById(id: string) {
  const conv = await prisma.conversation.findUnique({
    where: { id },
    include: {
      contact: { select: { id: true, number: true, name: true, email: true, phone: true, avatarUrl: true } },
      assignedTo: { select: { id: true, name: true, email: true, avatarUrl: true } },
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

  // Atribuir/remover pelo inbox SINCRONIZA tudo: conversa + contato +
  // negócios abertos do contato. Sem isso, "Remover responsável" limpava só
  // a conversa e o contato/negócio continuavam atribuídos (inconsistente) —
  // dava a impressão de que não removeu. Tudo numa transação (atômico).
  const updated = await prisma.$transaction(async (tx) => {
    const conv = await tx.conversation.update({
      where: { id: conversationId },
      data: {
        assignedToId: newAssigneeId,
        ...(shouldResetGreeted ? { aiGreetedAt: null } : {}),
      },
      include: {
        contact: { select: { id: true, number: true, name: true, email: true, phone: true, avatarUrl: true } },
        assignedTo: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });
    if (conv.contactId) {
      await tx.contact.update({
        where: { id: conv.contactId },
        data: { assignedToId: newAssigneeId },
      });
      await tx.deal.updateMany({
        where: { contactId: conv.contactId, status: "OPEN" },
        data: { ownerId: newAssigneeId },
      });
    }
    return conv;
  });

  return { ok: true, conversation: updated };
}

/**
 * Reabre uma conversa RESOLVED como NOVO ticket (regra "reabrir = novo id").
 * Se ja existe um ticket ativo pro contato+canal (ex.: um inbound reabriu
 * antes), reusa; caso contrario cria um novo, tratando a corrida do indice
 * unico parcial. Herda canal/jid/inbox/responsavel da conversa origem.
 */
export async function reopenResolvedAsNewTicket(sourceId: string): Promise<{
  id: string;
  created: boolean;
  contactId: string | null;
  channel: string;
}> {
  const src = await prisma.conversation.findUnique({
    where: { id: sourceId },
    select: {
      id: true, contactId: true, channel: true, channelId: true,
      waJid: true, inboxName: true, assignedToId: true,
    },
  });
  if (!src || !src.contactId) {
    return { id: sourceId, created: false, contactId: src?.contactId ?? null, channel: src?.channel ?? "" };
  }

  const findActive = () =>
    prisma.conversation.findFirst({
      where: { contactId: src.contactId!, channel: src.channel, status: { not: "RESOLVED" } },
      select: { id: true },
    });

  const existing = await findActive();
  if (existing) {
    return { id: existing.id, created: false, contactId: src.contactId, channel: src.channel };
  }

  try {
    const created = await withConversationNumberRetry((number) =>
      prisma.conversation.create({
        data: withOrgFromCtx({
          number,
          contactId: src.contactId!,
          channel: src.channel,
          status: "OPEN" as const,
          ...(src.channelId ? { channelId: src.channelId } : {}),
          ...(src.waJid ? { waJid: src.waJid } : {}),
          ...(src.inboxName ? { inboxName: src.inboxName } : {}),
          ...(src.assignedToId ? { assignedToId: src.assignedToId } : {}),
        }),
        select: { id: true },
      }),
    );
    return { id: created.id, created: true, contactId: src.contactId, channel: src.channel };
  } catch (err) {
    if (isActiveConversationUniqueViolation(err)) {
      const won = await findActive();
      if (won) return { id: won.id, created: false, contactId: src.contactId, channel: src.channel };
    }
    throw err;
  }
}

export async function getConversationLite(id: string) {
  return prisma.conversation.findUnique({
    where: { id },
    select: {
      id: true, externalId: true, contactId: true, status: true,
      channel: true, channelId: true, waJid: true, organizationId: true,
      number: true,
      channelRef: {
        select: { id: true, provider: true, config: true, name: true, phoneNumber: true, type: true },
      },
    },
  });
}

export async function updateConversationStatusInDb(
  id: string,
  status: ConversationStatus,
  extra?: {
    tabulationId?: string | null;
    /** Ao encerrar (RESOLVED), desvincula o atendente (assignedToId=null). */
    clearAssignedTo?: boolean;
    /** Ao encerrar (RESOLVED), desvincula o departamento (departmentId=null). */
    clearDepartment?: boolean;
  },
) {
  // closedAt: preencher quando encerra, limpar quando reabre. Fica em sync
  // com o status pra UI/relatorios sem consultar historico de eventos.
  // Outros valores (PENDING/SNOOZED) nao mexem em closedAt.
  const closedAtPatch: { closedAt: Date | null } | Record<string, never> =
    status === "RESOLVED"
      ? { closedAt: new Date() }
      : status === "OPEN"
        ? { closedAt: null }
        : {};

  // Reabrir (OPEN) limpa a tabulacao — coerente com "novo ciclo". O
  // caller pode passar `tabulationId` explicito no encerramento, ou omitir.
  const tabulationPatch: { tabulationId: string | null } | Record<string, never> =
    status === "OPEN"
      ? { tabulationId: null }
      : extra && "tabulationId" in extra
        ? { tabulationId: extra.tabulationId ?? null }
        : {};

  // Ao ENCERRAR: respeita as configs "Manter atendente/departamento ao
  // finalizar". Quando desligadas, o caller passa clearAssignedTo/
  // clearDepartment=true e desvinculamos os campos aqui.
  const clearPatch: { assignedToId?: null; departmentId?: null } =
    status === "RESOLVED"
      ? {
          ...(extra?.clearAssignedTo ? { assignedToId: null } : {}),
          ...(extra?.clearDepartment ? { departmentId: null } : {}),
        }
      : {};

  return prisma.conversation.update({
    where: { id },
    data: { status, ...closedAtPatch, ...tabulationPatch, ...clearPatch },
    include: { contact: { select: { id: true, number: true, name: true, email: true, phone: true, avatarUrl: true } } },
  });
}

/**
 * Retorna o proximo `number` sequencial de Conversation na org do
 * contexto atual. Mesmo padrao de `nextContactNumber()` — a Prisma
 * extension escopa o `_max` por org via AsyncLocalStorage. Combinar
 * com retry P2002 na criacao para lidar com corrida entre workers/webhooks.
 */
export async function nextConversationNumber(): Promise<number> {
  const r = await prisma.conversation.aggregate({ _max: { number: true } });
  return (r._max.number ?? 0) + 1;
}

/**
 * Detecta P2002 do indice unico PARCIAL que garante no maximo UMA conversa
 * ativa (status != RESOLVED) por (organizationId, contactId, channel).
 * Criado na migration `conversations_active_contact_channel`. Usado pelos
 * pontos de criacao (baileys/meta/whatsapp-conversation) para tratar a
 * corrida de mensagens simultaneas do mesmo numero: em vez de criar um 2o
 * ticket, o caller relê e reusa o ticket vencedor.
 */
export function isActiveConversationUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; meta?: { target?: string[] | string } };
  if (e.code !== "P2002") return false;
  const target = e.meta?.target;
  const hit = (s: string) =>
    s.includes("active_contact_channel") || s.includes("contactId");
  if (Array.isArray(target)) return target.some(hit);
  if (typeof target === "string") return hit(target);
  return false;
}

const CONVERSATION_NUMBER_MAX_RETRIES = 5;

/**
 * Detecta P2002 no unique (organizationId, number). Outros P2002
 * (externalId, etc) NAO devem ser retentados aqui — deixamos borbulhar
 * para o caller tratar.
 */
function isConversationNumberUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; meta?: { target?: string[] | string } };
  if (e.code !== "P2002") return false;
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.includes("number");
  if (typeof target === "string") return target.includes("number");
  return false;
}

/**
 * Executa `run(number)` com retry ate 5 vezes se der P2002 no unique
 * (organizationId, number). Uso pra centralizar a logica de numero
 * sequencial de Conversation em todos os pontos de criacao — mesma
 * ideia do loop em `createContact` (services/contacts.ts). O caller
 * mantem o tipo retornado (generic T), sem gymnastics de Prisma types.
 */
export async function withConversationNumberRetry<T>(
  run: (number: number) => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < CONVERSATION_NUMBER_MAX_RETRIES; attempt++) {
    const number = await nextConversationNumber();
    try {
      return await run(number);
    } catch (err) {
      if (isConversationNumberUniqueViolation(err)) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw (
    lastErr ??
    new Error(
      `withConversationNumberRetry: max ${CONVERSATION_NUMBER_MAX_RETRIES} retries exceeded`,
    )
  );
}
