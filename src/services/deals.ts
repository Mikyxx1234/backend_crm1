import { Prisma, type DealStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getStageMetrics } from "@/services/analytics";
import { enrichContactsWithUserAvatarFallback } from "@/lib/contact-avatar-fallback";

export function isValidDealStatus(v: string): v is DealStatus {
  return v === "OPEN" || v === "WON" || v === "LOST";
}

export function createDealEvent(
  dealId: string,
  userId: string | null,
  type: string,
  meta: Record<string, unknown> = {},
) {
  // Prisma aceita `InputJsonValue` em campos Json; cast é seguro pq o
  // caller sempre passa um objeto "plain JSON" (Date/undefined/funcs
  // não passam no filtro; quando passarem, o DB lança runtime error).
  const metaJson = meta as Prisma.InputJsonValue;
  return prisma.dealEvent
    .create({ data: { dealId, userId, type, meta: metaJson } })
    .catch(() =>
      prisma.dealEvent.create({ data: { dealId, userId: null, type, meta: metaJson } }),
    );
}

export type GetDealsParams = {
  pipelineId?: string;
  stageId?: string;
  status?: DealStatus;
  ownerId?: string;
  search?: string;
  page?: number;
  perPage?: number;
  visibilityWhere?: Prisma.DealWhereInput;
};

const listInclude = {
  contact: { select: { id: true, name: true, email: true, phone: true, avatarUrl: true } },
  stage: {
    select: {
      id: true,
      name: true,
      position: true,
      color: true,
      pipelineId: true,
    },
  },
  owner: { select: { id: true, name: true, email: true, avatarUrl: true } },
} satisfies Prisma.DealInclude;

export async function getDeals(params: GetDealsParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(100, Math.max(1, params.perPage ?? 20));
  const skip = (page - 1) * perPage;

  const conditions: Prisma.DealWhereInput[] = [];

  if (params.visibilityWhere && Object.keys(params.visibilityWhere).length > 0) {
    conditions.push(params.visibilityWhere);
  }

  if (params.pipelineId) {
    conditions.push({ stage: { pipelineId: params.pipelineId } });
  }
  if (params.stageId) {
    conditions.push({ stageId: params.stageId });
  }
  if (params.status) {
    conditions.push({ status: params.status });
  }
  if (params.ownerId) {
    conditions.push({ ownerId: params.ownerId });
  }

  const search = params.search?.trim();
  if (search) {
    conditions.push({
      OR: [
        { title: { contains: search, mode: "insensitive" } },
        { contact: { name: { contains: search, mode: "insensitive" } } },
        { contact: { email: { contains: search, mode: "insensitive" } } },
      ],
    });
  }

  const where: Prisma.DealWhereInput =
    conditions.length > 0 ? { AND: conditions } : {};

  const [items, total] = await Promise.all([
    prisma.deal.findMany({
      where,
      skip,
      take: perPage,
      orderBy: [{ updatedAt: "desc" }],
      include: listInclude,
    }),
    prisma.deal.count({ where }),
  ]);

  await enrichContactsWithUserAvatarFallback(
    items.map((d) => d.contact).filter((c): c is NonNullable<typeof c> => c !== null),
  );

  return { items, total, page, perPage };
}

const detailInclude = {
  contact: {
    select: {
      id: true, name: true, email: true, phone: true, avatarUrl: true,
      conversations: {
        orderBy: { updatedAt: "desc" as const },
        select: {
          id: true, externalId: true, channel: true,
          status: true, inboxName: true, createdAt: true, updatedAt: true,
        },
      },
      tags: {
        select: {
          tag: { select: { id: true, name: true, color: true } },
        },
      },
    },
  },
  tags: {
    select: {
      tag: { select: { id: true, name: true, color: true } },
    },
  },
  stage: {
    select: {
      id: true, name: true, position: true, color: true,
      pipeline: {
        select: {
          id: true, name: true,
          stages: {
            orderBy: { position: "asc" as const },
            select: { id: true, name: true, color: true, position: true },
          },
        },
      },
    },
  },
  owner: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } },
  activities: {
    take: 30,
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  },
  notes: {
    take: 30,
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  },
} satisfies Prisma.DealInclude;

export async function getDealById(idOrNumber: string) {
  const isNumeric = /^\d+$/.test(idOrNumber);
  const deal = await prisma.deal.findUnique({
    where: isNumeric ? { number: parseInt(idOrNumber, 10) } : { id: idOrNumber },
    include: detailInclude,
  });
  if (deal?.contact) {
    await enrichContactsWithUserAvatarFallback([deal.contact]);
  }
  return deal;
}

export type CreateDealInput = {
  /** Só importação: manter id do export. */
  id?: string;
  /** ID externo do lead (ex.: Kommo). */
  externalId?: string | null;
  title: string;
  value?: number | string;
  status?: DealStatus;
  expectedClose?: Date | string | null;
  lostReason?: string | null;
  position?: number;
  contactId?: string | null;
  stageId: string;
  ownerId?: string | null;
};

export async function createDeal(data: CreateDealInput) {
  const title = data.title.trim();
  if (!title) throw new Error("INVALID_TITLE");

  const maxPos = await prisma.deal.aggregate({
    where: { stageId: data.stageId },
    _max: { position: true },
  });
  const position = data.position ?? (maxPos._max.position ?? -1) + 1;

  return prisma.deal.create({
    data: {
      ...(data.id ? { id: data.id } : {}),
      title,
      externalId: data.externalId === undefined ? undefined : data.externalId,
      value: data.value !== undefined ? data.value : undefined,
      status: data.status,
      expectedClose: data.expectedClose === undefined ? undefined : data.expectedClose,
      lostReason: data.lostReason === undefined ? undefined : data.lostReason,
      position,
      contactId: data.contactId === undefined ? undefined : data.contactId,
      stageId: data.stageId,
      ownerId: data.ownerId === undefined ? undefined : data.ownerId,
    },
    include: listInclude,
  });
}

export type UpdateDealInput = {
  title?: string;
  externalId?: string | null;
  value?: number | string | null;
  status?: DealStatus;
  expectedClose?: Date | string | null;
  lostReason?: string | null;
  position?: number;
  contactId?: string | null;
  stageId?: string;
  ownerId?: string | null;
};

export async function updateDeal(id: string, data: UpdateDealInput) {
  const payload: Prisma.DealUpdateInput = {};

  if (data.title !== undefined) {
    const title = data.title.trim();
    if (!title) throw new Error("INVALID_TITLE");
    payload.title = title;
  }
  if (data.value !== undefined) {
    payload.value = data.value === null ? 0 : data.value;
  }
  if (data.status !== undefined) payload.status = data.status;
  if (data.expectedClose !== undefined) payload.expectedClose = data.expectedClose;
  if (data.lostReason !== undefined) payload.lostReason = data.lostReason;
  if (data.position !== undefined) payload.position = data.position;
  if (data.contactId !== undefined) {
    payload.contact =
      data.contactId === null ? { disconnect: true } : { connect: { id: data.contactId } };
  }
  if (data.stageId !== undefined) {
    payload.stage = { connect: { id: data.stageId } };
  }
  if (data.ownerId !== undefined) {
    payload.owner =
      data.ownerId === null ? { disconnect: true } : { connect: { id: data.ownerId } };
  }
  if (data.externalId !== undefined) {
    payload.externalId = data.externalId;
  }

  if (Object.keys(payload).length === 0) {
    throw new Error("EMPTY_UPDATE");
  }

  // REGRA DE HERANÇA DE RESPONSÁVEL (ver `assignDealOwner` abaixo).
  return prisma.$transaction(async (tx) => {
    const updated = await tx.deal.update({
      where: { id },
      data: payload,
      include: listInclude,
    });

    if (data.ownerId !== undefined) {
      const contactId =
        data.contactId !== undefined ? data.contactId : updated.contactId;
      await propagateOwnerToContactAndChat(tx, contactId, data.ownerId);
    }

    return updated;
  });
}

/**
 * Propaga o `ownerId` do deal para o contato e as conversas desse
 * contato — regra de herança do "responsável único": quando um deal
 * é distribuído/transferido, o contato vinculado e todas as
 * conversas desse contato herdam o mesmo assignee. Evita ter
 * Atendimento/Contato/Chat em pessoas diferentes.
 *
 * Exposto como helper para que `updateDeal`, a rota bulk e o
 * executor de automações apliquem a mesma cascata.
 *
 * - `ownerId === null` → desatribui contato e conversas.
 * - `contactId === null` → no-op (não há a quem propagar).
 * - Deve rodar dentro de uma transaction (`tx`) — a função não
 *   abre uma própria para poder compor com contextos maiores.
 */
export async function propagateOwnerToContactAndChat(
  tx: Prisma.TransactionClient,
  contactId: string | null | undefined,
  ownerId: string | null,
) {
  if (!contactId) return;
  await tx.contact.update({
    where: { id: contactId },
    data: { assignedToId: ownerId },
  });
  // Só reseta aiGreetedAt quando o assignedToId MUDA — evita flush
  // acidental quando a automação roda sem alteração real.
  await tx.conversation.updateMany({
    where: { contactId, NOT: { assignedToId: ownerId } },
    data: { assignedToId: ownerId, aiGreetedAt: null },
  });
}

/**
 * Atribui um responsável a um deal e propaga a atribuição para o
 * contato e as conversas (regra de herança). Use esta função sempre
 * que for mudar `Deal.ownerId` de forma isolada (sem outros campos).
 */
export async function assignDealOwner(
  dealId: string,
  ownerId: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const deal = await tx.deal.update({
      where: { id: dealId },
      data: { ownerId },
      select: { id: true, contactId: true, ownerId: true },
    });
    await propagateOwnerToContactAndChat(tx, deal.contactId, ownerId);
    return deal;
  });
}

export async function deleteDeal(id: string) {
  await prisma.deal.delete({ where: { id } });
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export async function moveDeal(dealId: string, targetStageId: string, position: number) {
  if (!Number.isInteger(position) || position < 0) {
    throw new Error("INVALID_POSITION");
  }

  return prisma.$transaction(async (tx) => {
    const deal = await tx.deal.findUnique({ where: { id: dealId } });
    if (!deal) throw new Error("NOT_FOUND");

    const targetStage = await tx.stage.findUnique({ where: { id: targetStageId } });
    if (!targetStage) throw new Error("STAGE_NOT_FOUND");

    const dealStage = await tx.stage.findUnique({ where: { id: deal.stageId } });
    if (!dealStage || dealStage.pipelineId !== targetStage.pipelineId) {
      throw new Error("CROSS_PIPELINE");
    }

    const oldStageId = deal.stageId;
    const oldPos = deal.position;

    if (oldStageId === targetStageId) {
      const deals = await tx.deal.findMany({
        where: { stageId: targetStageId },
        orderBy: { position: "asc" },
      });
      const ordered = deals.filter((d) => d.id !== dealId);
      const clamped = Math.min(position, ordered.length);
      ordered.splice(clamped, 0, deal);

      for (let i = 0; i < ordered.length; i++) {
        await tx.deal.update({
          where: { id: ordered[i].id },
          data: { position: i },
        });
      }

      return tx.deal.findUnique({
        where: { id: dealId },
        include: listInclude,
      });
    }

    await tx.deal.updateMany({
      where: { stageId: targetStageId, position: { gte: position } },
      data: { position: { increment: 1 } },
    });

    await tx.deal.update({
      where: { id: dealId },
      data: { stageId: targetStageId, position },
    });

    await tx.deal.updateMany({
      where: { stageId: oldStageId, position: { gt: oldPos } },
      data: { position: { decrement: 1 } },
    });

    return tx.deal.findUnique({
      where: { id: dealId },
      include: listInclude,
    });
  });
}

export async function markDealWon(id: string) {
  return prisma.deal.update({
    where: { id },
    data: {
      status: "WON",
      closedAt: new Date(),
    },
    include: listInclude,
  });
}

export async function markDealLost(id: string, lostReason: string) {
  const reason = lostReason.trim();
  if (!reason) throw new Error("INVALID_LOST_REASON");

  return prisma.deal.update({
    where: { id },
    data: {
      status: "LOST",
      closedAt: new Date(),
      lostReason: reason,
    },
    include: listInclude,
  });
}

export async function reopenDeal(id: string) {
  return prisma.deal.update({
    where: { id },
    data: {
      status: "OPEN",
      closedAt: null,
      lostReason: null,
    },
    include: listInclude,
  });
}

export async function getBoardData(
  pipelineId: string,
  visibilityOwnerId?: string | null,
  statusFilter?: DealStatus | "ALL",
) {
  const now = new Date();

  const dealWhere: Prisma.DealWhereInput = {};
  if (statusFilter && statusFilter !== "ALL") {
    dealWhere.status = statusFilter;
  } else if (!statusFilter) {
    dealWhere.status = "OPEN";
  }
  if (visibilityOwnerId) {
    dealWhere.ownerId = visibilityOwnerId;
  }

  const stages = await prisma.stage.findMany({
    where: { pipelineId },
    orderBy: { position: "asc" },
    include: {
      deals: {
        where: dealWhere,
        orderBy: { position: "asc" },
        include: {
          contact: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              avatarUrl: true,
            },
          },
          owner: { select: { id: true, name: true, avatarUrl: true } },
          tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
          activities: {
            where: { completed: false },
            select: { id: true, scheduledAt: true },
            take: 5,
          },
        },
      },
    },
  });

  const allDealIds = stages.flatMap((s) => s.deals.map((d) => d.id));
  const allContactIds = stages
    .flatMap((s) => s.deals)
    .map((d) => d.contactId)
    .filter((id): id is string => !!id);

  // Product names per deal
  const productMap = new Map<string, string>();
  const productTypeMap = new Map<string, string>();
  if (allDealIds.length > 0) {
    const dealProducts = await prisma.$queryRaw<{ dealId: string; name: string; type: string }[]>`
      SELECT dp."dealId", p.name, p.type
      FROM deal_products dp
      INNER JOIN products p ON p.id = dp."productId"
      WHERE dp."dealId" = ANY(${allDealIds})
      ORDER BY dp."createdAt" ASC
    `;
    for (const dp of dealProducts) {
      if (!productMap.has(dp.dealId)) {
        productMap.set(dp.dealId, dp.name);
        productTypeMap.set(dp.dealId, dp.type);
      }
    }
  }

  // Last message + unread + channel per contact.
  // Obs.: o "responsável" do contato e do chat são derivados de
  // `Deal.owner` via regra de herança (ver `propagateOwnerToContactAndChat`),
  // então não precisamos carregá-los separadamente aqui.
  //
  // O `channel` é exposto no card pra alimentar o badge do `ChatAvatar`
  // (ex.: bolinha verde do WhatsApp). Quando o contato tem múltiplas
  // conversas, vence o canal da MAIS RECENTE — segue a mesma escolha
  // de `lastMessage` pra manter consistência visual.
  const lastMsgMap = new Map<string, { content: string; createdAt: Date; direction: string }>();
  const unreadMap = new Map<string, number>();
  const channelMap = new Map<string, { channel: string; updatedAt: Date }>();

  if (allContactIds.length > 0) {
    const convs = await prisma.conversation.findMany({
      where: { contactId: { in: allContactIds } },
      select: {
        contactId: true,
        unreadCount: true,
        channel: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, createdAt: true, direction: true },
        },
      },
    });

    for (const conv of convs) {
      if (!conv.contactId) continue;

      if (conv.messages.length > 0) {
        const msg = conv.messages[0];
        const existing = lastMsgMap.get(conv.contactId);
        if (!existing || msg.createdAt > existing.createdAt) {
          lastMsgMap.set(conv.contactId, msg);
        }
      }

      const prev = unreadMap.get(conv.contactId) ?? 0;
      unreadMap.set(conv.contactId, prev + conv.unreadCount);

      // Se ainda não temos canal pra este contato, ou esta conv é mais
      // recente que a já registrada, atualiza. Garante que o badge no
      // card reflita o canal da conversa "ativa" do contato.
      const prevCh = channelMap.get(conv.contactId);
      if (!prevCh || conv.updatedAt > prevCh.updatedAt) {
        channelMap.set(conv.contactId, {
          channel: conv.channel,
          updatedAt: conv.updatedAt,
        });
      }
    }
  }

  const metrics = await getStageMetrics(pipelineId);
  const metricsMap = new Map(metrics.map((m) => [m.stageId, m]));

  // Enriquece contatos sem avatarUrl com a foto do User homônimo (se
  // existir). Caso típico: agente testando com seu próprio número.
  // É um fallback PURAMENTE VISUAL — ver `contact-avatar-fallback.ts`.
  const allContacts = stages
    .flatMap((s) => s.deals)
    .map((d) => d.contact)
    .filter((c): c is NonNullable<typeof c> => c !== null);
  await enrichContactsWithUserAvatarFallback(allContacts);

  return stages
    .filter((stage) => !stage.isIncoming || stage.deals.length > 0)
    .map((stage) => {
      const metric = metricsMap.get(stage.id);
      return {
        ...stage,
        conversionRate: metric?.conversionRate ?? 0,
        avgDaysInStage: metric?.avgDaysInStage ?? 0,
        deals: stage.deals.map((deal) => {
          const threshold = addDays(deal.updatedAt, stage.rottingDays);
          const isRotting = now.getTime() > threshold.getTime();
          const lastMsg = deal.contactId ? lastMsgMap.get(deal.contactId) : undefined;
          const tags = deal.tags?.map((t: { tag: { id: string; name: string; color: string } }) => t.tag) ?? [];
          const pendingActivities = deal.activities?.length ?? 0;
          const hasOverdueActivity = deal.activities?.some(
            (a) => a.scheduledAt && new Date(a.scheduledAt).getTime() < now.getTime()
          ) ?? false;
          return {
            ...deal,
            activities: undefined,
            isRotting,
            productName: productMap.get(deal.id) ?? null,
            productType: (productTypeMap.get(deal.id) as "PRODUCT" | "SERVICE") ?? null,
            tags,
            pendingActivities,
            hasOverdueActivity,
            unreadCount: deal.contactId ? (unreadMap.get(deal.contactId) ?? 0) : 0,
            lastMessage: lastMsg
              ? { content: lastMsg.content, createdAt: lastMsg.createdAt, direction: lastMsg.direction }
              : null,
            channel: deal.contactId
              ? channelMap.get(deal.contactId)?.channel ?? null
              : null,
          };
        }),
      };
    });
}
