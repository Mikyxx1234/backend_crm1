import type { LifecycleStage, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { enrichContactsWithUserAvatarFallback } from "@/lib/contact-avatar-fallback";
import { getLogger } from "@/lib/logger";

const log = getLogger("contacts-service");

const LIFECYCLE_STAGES: LifecycleStage[] = [
  "SUBSCRIBER",
  "LEAD",
  "MQL",
  "SQL",
  "OPPORTUNITY",
  "CUSTOMER",
  "EVANGELIST",
  "OTHER",
];

export function isValidLifecycleStage(v: string): v is LifecycleStage {
  return LIFECYCLE_STAGES.includes(v as LifecycleStage);
}

export type GetContactsParams = {
  search?: string;
  lifecycleStage?: LifecycleStage;
  tagIds?: string[];
  companyId?: string;
  page?: number;
  perPage?: number;
  sortBy?: "name" | "email" | "createdAt" | "updatedAt" | "leadScore" | "lifecycleStage";
  sortOrder?: "asc" | "desc";
};

const assignedToSelect = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  role: true,
} satisfies Prisma.UserSelect;

export async function getContacts(params: GetContactsParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(100, Math.max(1, params.perPage ?? 20));
  const skip = (page - 1) * perPage;
  const sortBy = params.sortBy ?? "createdAt";
  const sortOrder = params.sortOrder ?? "desc";

  const search = params.search?.trim();
  const where: Prisma.ContactWhereInput = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
    ];
  }

  if (params.lifecycleStage) {
    where.lifecycleStage = params.lifecycleStage;
  }

  if (params.companyId) {
    where.companyId = params.companyId;
  }

  if (params.tagIds && params.tagIds.length > 0) {
    where.tags = {
      some: { tagId: { in: params.tagIds } },
    };
  }

  const orderBy: Prisma.ContactOrderByWithRelationInput = (() => {
    switch (sortBy) {
      case "name":
        return { name: sortOrder };
      case "email":
        return { email: sortOrder };
      case "leadScore":
        return { leadScore: sortOrder };
      case "lifecycleStage":
        return { lifecycleStage: sortOrder };
      case "updatedAt":
        return { updatedAt: sortOrder };
      default:
        return { createdAt: sortOrder };
    }
  })();

  const [rawItems, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      skip,
      take: perPage,
      orderBy,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatarUrl: true,
        leadScore: true,
        lifecycleStage: true,
        createdAt: true,
        company: { select: { id: true, name: true, domain: true } },
        tags: {
          select: { tag: { select: { id: true, name: true, color: true } } },
        },
      },
    }),
    prisma.contact.count({ where }),
  ]);

  await enrichContactsWithUserAvatarFallback(rawItems);

  const contactIds = rawItems.map((c) => c.id);

  let dealAggMap = new Map<
    string,
    { totalValue: number; dealCount: number; lastDealAt: Date | null; firstDealAt: Date | null }
  >();

  if (contactIds.length > 0) {
    const dealAggs = await prisma.$queryRaw<
      { contactId: string; totalValue: string; dealCount: bigint; lastDealAt: Date | null; firstDealAt: Date | null }[]
    >`
      SELECT
        d."contactId",
        COALESCE(SUM(d.value), 0) as "totalValue",
        COUNT(d.id) as "dealCount",
        MAX(d."createdAt") as "lastDealAt",
        MIN(d."createdAt") as "firstDealAt"
      FROM deals d
      WHERE d."contactId" = ANY(${contactIds})
        AND d.status = 'WON'
      GROUP BY d."contactId"
    `;

    dealAggMap = new Map(
      dealAggs.map((r) => [
        r.contactId,
        {
          totalValue: parseFloat(r.totalValue) || 0,
          dealCount: Number(r.dealCount),
          lastDealAt: r.lastDealAt,
          firstDealAt: r.firstDealAt,
        },
      ]),
    );
  }

  const items = rawItems.map((c) => {
    const agg = dealAggMap.get(c.id);
    const dealCount = agg?.dealCount ?? 0;
    const totalValue = agg?.totalValue ?? 0;
    const avgTicket = dealCount > 0 ? totalValue / dealCount : 0;
    const lastDealAt = agg?.lastDealAt ?? null;
    const firstDealAt = agg?.firstDealAt ?? null;

    let purchaseCycleDays = 0;
    if (firstDealAt && lastDealAt && dealCount > 1) {
      purchaseCycleDays = Math.round(
        (lastDealAt.getTime() - firstDealAt.getTime()) / (1000 * 60 * 60 * 24) / (dealCount - 1),
      );
    }

    let daysSinceLastPurchase = 0;
    if (lastDealAt) {
      daysSinceLastPurchase = Math.round(
        (Date.now() - lastDealAt.getTime()) / (1000 * 60 * 60 * 24),
      );
    }

    return {
      ...c,
      tags: c.tags.map((t) => t.tag),
      totalValue,
      dealCount,
      avgTicket,
      purchaseCycleDays,
      daysSinceLastPurchase,
    };
  });

  return {
    items,
    total,
    page,
    perPage,
    totalPages: Math.ceil(total / perPage) || 1,
  };
}

export type CreateContactInput = {
  /** Só importação / migração: fixar o mesmo id do export. */
  id?: string;
  /** ID externo (ex.: Kommo) para reimportar sem duplicar. */
  externalId?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  leadScore?: number;
  lifecycleStage?: LifecycleStage;
  source?: string | null;
  companyId?: string | null;
  assignedToId?: string | null;
};

export type UpdateContactInput = Partial<CreateContactInput>;

function dealValueToString(value: Prisma.Decimal) {
  return value.toString();
}

export type InboxLeadPanelFieldRow = {
  fieldId: string;
  name: string;
  label: string;
  type: string;
  options: string[];
  value: string | null;
};

/** Campos de contato marcados para o painel Lead na Inbox (com valor ou vazio). */
export async function getInboxLeadPanelFieldsForContact(
  contactId: string
): Promise<InboxLeadPanelFieldRow[]> {
  const fields = await prisma.customField.findMany({
    where: { entity: "contact", showInInboxLeadPanel: true },
  });
  fields.sort(
    (a, b) =>
      (a.inboxLeadPanelOrder ?? 9999) - (b.inboxLeadPanelOrder ?? 9999) ||
      a.label.localeCompare(b.label, "pt-BR")
  );

  if (fields.length === 0) return [];

  const fieldIds = fields.map((f) => f.id);
  const values = await prisma.contactCustomFieldValue.findMany({
    where: { contactId, customFieldId: { in: fieldIds } },
    select: { customFieldId: true, value: true },
  });
  const valueByField = new Map(values.map((v) => [v.customFieldId, v.value]));

  return fields.map((f) => ({
    fieldId: f.id,
    name: f.name,
    label: f.label,
    type: f.type,
    options: f.options,
    value: valueByField.get(f.id) ?? null,
  }));
}

/** Campos de negócio marcados para o painel lateral na Inbox (com valor ou vazio). */
export async function getInboxLeadPanelFieldsForDeal(
  dealId: string
): Promise<InboxLeadPanelFieldRow[]> {
  const fields = await prisma.customField.findMany({
    where: { entity: "deal", showInInboxLeadPanel: true },
  });
  fields.sort(
    (a, b) =>
      (a.inboxLeadPanelOrder ?? 9999) - (b.inboxLeadPanelOrder ?? 9999) ||
      a.label.localeCompare(b.label, "pt-BR")
  );

  if (fields.length === 0) return [];

  const fieldIds = fields.map((f) => f.id);
  const values = await prisma.dealCustomFieldValue.findMany({
    where: { dealId, customFieldId: { in: fieldIds } },
    select: { customFieldId: true, value: true },
  });
  const valueByField = new Map(values.map((v) => [v.customFieldId, v.value]));

  return fields.map((f) => ({
    fieldId: f.id,
    name: f.name,
    label: f.label,
    type: f.type,
    options: f.options,
    value: valueByField.get(f.id) ?? null,
  }));
}

/**
 * Verifica apenas se existe um contato com o id. Usa findUnique mínimo
 * (sem includes) pra não arrastar falhas de relações — garantindo que
 * endpoints DELETE/PUT possam checar existência mesmo quando alguma
 * relação (tags, deals, conversations) estiver em estado inconsistente.
 */
export async function contactExists(id: string): Promise<boolean> {
  try {
    const row = await prisma.contact.findUnique({
      where: { id },
      select: { id: true },
    });
    return !!row;
  } catch (err) {
    log.error(`contactExists(${id}) falhou:`, err);
    throw err;
  }
}

/**
 * Carrega o contato + relações. Historicamente fazia 1 findUnique com
 * include aninhado gigante; se QUALQUER relação falhasse (schema drift,
 * registro órfão, cliente Prisma fora de sincronia) a query toda era
 * derrubada e o endpoint acabava retornando 404 "Contato não encontrado"
 * ou 500 genérico — exatamente o sintoma "não consigo abrir nenhum
 * contato".
 *
 * Agora: busca o core separado e cada relação em paralelo, com try/catch
 * individual. Se o core existe mas uma relação falha, a relação vira
 * array vazio e o contato ainda é renderizado.
 */
export async function getContactById(id: string) {
  let core: Awaited<ReturnType<typeof prisma.contact.findUnique>> | null = null;
  try {
    core = await prisma.contact.findUnique({ where: { id } });
  } catch (err) {
    log.error(`findUnique(core) falhou para contato ${id}:`, err);
    throw err;
  }

  if (!core) {
    log.debug(`contato ${id} não encontrado (findUnique core retornou null)`);
    return null;
  }

  const safe = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      log.error(`getContactById(${id}): falha carregando "${label}" — retornando fallback:`, err);
      return fallback;
    }
  };

  const [
    company,
    assignedTo,
    tags,
    activities,
    deals,
    notes,
    conversations,
    inboxLeadPanelFields,
  ] = await Promise.all([
    core.companyId
      ? safe(
          "company",
          () =>
            prisma.company.findUnique({
              where: { id: core!.companyId! },
              select: { id: true, name: true, domain: true },
            }),
          null,
        )
      : Promise.resolve(null),
    core.assignedToId
      ? safe(
          "assignedTo",
          () =>
            prisma.user.findUnique({
              where: { id: core!.assignedToId! },
              select: assignedToSelect,
            }),
          null,
        )
      : Promise.resolve(null),
    safe(
      "tags",
      () =>
        prisma.tagOnContact.findMany({
          where: { contactId: id },
          include: { tag: { select: { id: true, name: true, color: true } } },
        }),
      [] as Array<{ contactId: string; tagId: string; tag: { id: string; name: string; color: string | null } }>,
    ),
    safe(
      "activities",
      () =>
        prisma.activity.findMany({
          where: { contactId: id },
          take: 20,
          orderBy: { createdAt: "desc" },
          include: {
            user: { select: assignedToSelect },
            deal: { select: { id: true, title: true } },
          },
        }),
      [] as Awaited<
        ReturnType<
          typeof prisma.activity.findMany<{
            include: {
              user: { select: typeof assignedToSelect };
              deal: { select: { id: true; title: true } };
            };
          }>
        >
      >,
    ),
    safe(
      "deals",
      () =>
        prisma.deal.findMany({
          where: { contactId: id },
          take: 20,
          orderBy: { updatedAt: "desc" },
          include: {
            stage: { select: { id: true, name: true, color: true } },
            owner: { select: assignedToSelect },
          },
        }),
      [] as Awaited<
        ReturnType<
          typeof prisma.deal.findMany<{
            include: {
              stage: { select: { id: true; name: true; color: true } };
              owner: { select: typeof assignedToSelect };
            };
          }>
        >
      >,
    ),
    safe(
      "notes",
      () =>
        prisma.note.findMany({
          where: { contactId: id },
          take: 30,
          orderBy: { createdAt: "desc" },
          include: { user: { select: assignedToSelect } },
        }),
      [] as Awaited<
        ReturnType<
          typeof prisma.note.findMany<{
            include: { user: { select: typeof assignedToSelect } };
          }>
        >
      >,
    ),
    safe(
      "conversations",
      () =>
        prisma.conversation.findMany({
          where: { contactId: id },
          take: 50,
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            externalId: true,
            channel: true,
            status: true,
            inboxName: true,
            createdAt: true,
            updatedAt: true,
            assignedToId: true,
            assignedTo: { select: { id: true, name: true, email: true } },
            tags: {
              select: {
                tag: { select: { id: true, name: true, color: true } },
              },
            },
          },
        }),
      [] as Awaited<
        ReturnType<
          typeof prisma.conversation.findMany<{
            select: {
              id: true;
              externalId: true;
              channel: true;
              status: true;
              inboxName: true;
              createdAt: true;
              updatedAt: true;
              assignedToId: true;
              assignedTo: { select: { id: true; name: true; email: true } };
              tags: {
                select: {
                  tag: { select: { id: true; name: true; color: true } };
                };
              };
            };
          }>
        >
      >,
    ),
    safe("inboxLeadPanelFields", () => getInboxLeadPanelFieldsForContact(id), [] as InboxLeadPanelFieldRow[]),
  ]);

  const activeDeal = deals.find((d) => d.status === "OPEN");
  const dealInboxPanelFields: Record<string, InboxLeadPanelFieldRow[]> = {};
  if (activeDeal) {
    const dealFields = await safe(
      "dealInboxPanelFields",
      () => getInboxLeadPanelFieldsForDeal(activeDeal.id),
      [] as InboxLeadPanelFieldRow[],
    );
    if (dealFields.length > 0) {
      dealInboxPanelFields[activeDeal.id] = dealFields;
    }
  }

  return {
    ...core,
    company,
    assignedTo,
    tags,
    activities,
    deals: deals.map((d) => ({
      ...d,
      value: dealValueToString(d.value),
    })),
    notes,
    conversations,
    inboxLeadPanelFields,
    dealInboxPanelFields,
  };
}

export async function createContact(data: CreateContactInput) {
  return prisma.contact.create({
    data: {
      ...(data.id ? { id: data.id } : {}),
      name: data.name,
      externalId: data.externalId === undefined ? undefined : data.externalId,
      email: data.email ?? undefined,
      phone: data.phone ?? undefined,
      avatarUrl: data.avatarUrl ?? undefined,
      leadScore: data.leadScore ?? undefined,
      lifecycleStage: data.lifecycleStage ?? undefined,
      source: data.source ?? undefined,
      companyId: data.companyId ?? undefined,
      assignedToId: data.assignedToId ?? undefined,
    },
    include: {
      company: { select: { id: true, name: true, domain: true } },
      tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
      assignedTo: { select: assignedToSelect },
    },
  });
}

export async function updateContact(id: string, data: UpdateContactInput) {
  const updateData: Prisma.ContactUpdateInput = {};

  if (data.name !== undefined) updateData.name = data.name;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.avatarUrl !== undefined) updateData.avatarUrl = data.avatarUrl;
  if (data.leadScore !== undefined) updateData.leadScore = data.leadScore;
  if (data.lifecycleStage !== undefined) updateData.lifecycleStage = data.lifecycleStage;
  if (data.source !== undefined) updateData.source = data.source;
  if (data.companyId !== undefined) {
    updateData.company =
      data.companyId === null ? { disconnect: true } : { connect: { id: data.companyId } };
  }
  if (data.assignedToId !== undefined) {
    updateData.assignedTo =
      data.assignedToId === null ? { disconnect: true } : { connect: { id: data.assignedToId } };
  }
  if (data.externalId !== undefined) {
    updateData.externalId = data.externalId;
  }

  return prisma.contact.update({
    where: { id },
    data: updateData,
    include: {
      company: { select: { id: true, name: true, domain: true } },
      tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
      assignedTo: { select: assignedToSelect },
    },
  });
}

export async function checkContactDeals(id: string): Promise<{ hasDeals: boolean; dealCount: number }> {
  const dealCount = await prisma.deal.count({ where: { contactId: id } });
  return { hasDeals: dealCount > 0, dealCount };
}

/**
 * Remove o contato e todas as relações que não estão marcadas como
 * onDelete: Cascade no schema. As que SÃO Cascade (TagOnContact,
 * ContactCustomFieldValue, AutomationContext, ScheduledWhatsappCall,
 * CampaignRecipient, ContactPhoneChange) caem junto pelo próprio banco.
 *
 * Pressupõe que o caller já checou que não há deals abertos (endpoint
 * usa `checkContactDeals`). Se mesmo assim um deal estiver apontando
 * para esse contato, nulificamos a FK em vez de deletar o deal.
 */
export async function deleteContact(id: string) {
  await prisma.$transaction(async (tx) => {
    const convs = await tx.conversation.findMany({
      where: { contactId: id },
      select: { id: true },
    });
    if (convs.length > 0) {
      const convIds = convs.map((c) => c.id);
      await tx.message.deleteMany({ where: { conversationId: { in: convIds } } });
      await tx.conversation.deleteMany({ where: { id: { in: convIds } } });
    }

    await tx.activity.deleteMany({ where: { contactId: id } });
    await tx.note.deleteMany({ where: { contactId: id } });
    await tx.automationLog.deleteMany({ where: { contactId: id } });

    await tx.deal.updateMany({
      where: { contactId: id },
      data: { contactId: null },
    });

    await tx.whatsappCallEvent.updateMany({
      where: { contactId: id },
      data: { contactId: null },
    });

    await tx.contact.delete({ where: { id } });
  });
}

type ActivityWithRelations = Awaited<
  ReturnType<
    typeof prisma.activity.findMany<{
      include: {
        user: { select: typeof assignedToSelect };
        deal: { select: { id: true; title: true } };
      };
    }>
  >
>[number];

type NoteWithUser = Awaited<
  ReturnType<
    typeof prisma.note.findMany<{
      include: { user: { select: typeof assignedToSelect } };
    }>
  >
>[number];

type DealTimelinePayload = Omit<
  Awaited<
    ReturnType<
      typeof prisma.deal.findMany<{
        include: {
          stage: { select: { id: true; name: true; color: true } };
          owner: { select: typeof assignedToSelect };
        };
      }>
    >
  >[number],
  "value"
> & { value: string };

export type TimelineItem =
  | { kind: "activity"; at: Date; activity: ActivityWithRelations }
  | { kind: "note"; at: Date; note: NoteWithUser }
  | { kind: "deal"; at: Date; event: "created" | "updated" | "closed"; deal: DealTimelinePayload };

export async function getContactTimeline(contactId: string): Promise<TimelineItem[]> {
  const [activities, notes, deals] = await Promise.all([
    prisma.activity.findMany({
      where: { contactId },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: assignedToSelect },
        deal: { select: { id: true, title: true } },
      },
    }),
    prisma.note.findMany({
      where: { contactId },
      orderBy: { createdAt: "desc" },
      include: { user: { select: assignedToSelect } },
    }),
    prisma.deal.findMany({
      where: { contactId },
      orderBy: { updatedAt: "desc" },
      include: {
        stage: { select: { id: true, name: true, color: true } },
        owner: { select: assignedToSelect },
      },
    }),
  ]);

  const items: TimelineItem[] = [];

  for (const activity of activities) {
    const at = activity.scheduledAt ?? activity.completedAt ?? activity.createdAt;
    items.push({ kind: "activity", at, activity });
  }

  for (const note of notes) {
    items.push({ kind: "note", at: note.createdAt, note });
  }

  for (const deal of deals) {
    const base = { ...deal, value: dealValueToString(deal.value) };
    items.push({ kind: "deal", at: deal.createdAt, event: "created", deal: base });
    if (deal.updatedAt.getTime() !== deal.createdAt.getTime()) {
      items.push({ kind: "deal", at: deal.updatedAt, event: "updated", deal: base });
    }
    if (deal.closedAt) {
      items.push({ kind: "deal", at: deal.closedAt, event: "closed", deal: base });
    }
  }

  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  return items;
}
