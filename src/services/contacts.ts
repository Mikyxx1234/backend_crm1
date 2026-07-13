import type { LifecycleStage, Prisma } from "@prisma/client";

import { resolveHighlight, type ResolvedHighlight } from "@/lib/highlight";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { getOrgIdOrThrow } from "@/lib/request-context";
import { normalizePhone, phoneMatchVariants } from "@/lib/phone";
import { enrichContactsWithUserAvatarFallback } from "@/lib/contact-avatar-fallback";
import { getLogger } from "@/lib/logger";
import { logEvent } from "@/services/activity-log";

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

export type ContactCustomFieldFilter = {
  /** Nome do CustomField (ex.: curso_interesse, graduacao). */
  name: string;
  /** eq | contains | filled (tem valor não vazio). */
  operator?: "eq" | "contains" | "filled";
  value?: string;
};

export type GetContactsParams = {
  search?: string;
  lifecycleStage?: LifecycleStage;
  tagIds?: string[];
  companyId?: string;
  /** Filtros por campos customizados do contato (AND entre itens). */
  customFieldFilters?: ContactCustomFieldFilter[];
  /**
   * Match EXATO de email (case-insensitive). Pensado para integrações que
   * precisam responder "esse lead já existe?" sem o ruído do `search`
   * (que faz contains em vários campos e pode retornar falsos positivos).
   */
  emailExact?: string;
  /**
   * Match EXATO de telefone, tolerante a formatação. Se o input vier com
   * 8+ dígitos, casamos tanto pelo valor cru salvo no DB quanto pelos
   * últimos N dígitos (endsWith), absorvendo variações como `+5511...`
   * vs `(11) 9...`. Para n8n: passe só dígitos no query param.
   */
  phoneExact?: string;
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
  // 27/mai/26 — Cap subido de 100 → 200 pra permitir o operador
  // listar mais leads por página (UI ganhou seletor 20/50/100/200).
  const perPage = Math.min(200, Math.max(1, params.perPage ?? 20));
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
      {
        customFields: {
          some: {
            value: { contains: search, mode: "insensitive" },
          },
        },
      },
    ];
  }

  if (params.customFieldFilters && params.customFieldFilters.length > 0) {
    const fieldNames = params.customFieldFilters.map((f) => f.name.trim()).filter(Boolean);
    if (fieldNames.length > 0) {
      const defs = await prisma.customField.findMany({
        where: { entity: "contact", name: { in: fieldNames } },
        select: { id: true, name: true },
      });
      const byName = new Map(defs.map((d) => [d.name, d.id]));

      const andFilters: Prisma.ContactWhereInput[] = [];
      for (const f of params.customFieldFilters) {
        const name = f.name.trim();
        const fieldId = byName.get(name);
        if (!fieldId) continue;

        const op = f.operator ?? (f.value ? "eq" : "filled");
        if (op === "filled") {
          andFilters.push({
            customFields: {
              some: {
                customFieldId: fieldId,
                value: { not: "" },
              },
            },
          });
        } else if (op === "contains" && f.value?.trim()) {
          andFilters.push({
            customFields: {
              some: {
                customFieldId: fieldId,
                value: { contains: f.value.trim(), mode: "insensitive" },
              },
            },
          });
        } else if (f.value !== undefined) {
          andFilters.push({
            customFields: {
              some: {
                customFieldId: fieldId,
                value: f.value,
              },
            },
          });
        }
      }

      if (andFilters.length > 0) {
        where.AND = [...(Array.isArray(where.AND) ? where.AND : []), ...andFilters];
      }
    }
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

  const exactFilters: Prisma.ContactWhereInput[] = [];

  const emailExact = params.emailExact?.trim().toLowerCase();
  if (emailExact) {
    exactFilters.push({
      email: { equals: emailExact, mode: "insensitive" },
    });
  }

  const phoneRaw = params.phoneExact?.trim();
  if (phoneRaw) {
    const digits = phoneRaw.replace(/\D/g, "");
    const phoneOr: Prisma.ContactWhereInput[] = [{ phone: { equals: phoneRaw } }];
    if (digits && digits.length >= 8) {
      phoneOr.push({ phone: { endsWith: digits } });
    }
    exactFilters.push(phoneOr.length === 1 ? phoneOr[0] : { OR: phoneOr });
  }

  if (exactFilters.length > 0) {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), ...exactFilters];
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
    const orgId = getOrgIdOrThrow();
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
        AND d."organizationId" = ${orgId}
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
  highlightRules: unknown[];
  highlight: ResolvedHighlight | null;
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

  return fields.map((f) => {
    const value = valueByField.get(f.id) ?? null;
    return {
      fieldId: f.id,
      name: f.name,
      label: f.label,
      type: f.type,
      options: f.options,
      value,
      highlightRules: Array.isArray(f.highlightRules) ? f.highlightRules : [],
      highlight: resolveHighlight(value, f.highlightRules),
    };
  });
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

  return fields.map((f) => {
    const value = valueByField.get(f.id) ?? null;
    return {
      fieldId: f.id,
      name: f.name,
      label: f.label,
      type: f.type,
      options: f.options,
      value,
      highlightRules: Array.isArray(f.highlightRules) ? f.highlightRules : [],
      highlight: resolveHighlight(value, f.highlightRules),
    };
  });
}

/**
 * Versão em LOTE de `getInboxLeadPanelFieldsForDeal` para vários negócios de
 * uma vez. Retorna um mapa `dealId → campos` (cada negócio recebe TODOS os
 * custom fields marcados para o painel, com o valor daquele negócio ou null).
 *
 * Faz 2 queries no total (defs + valores de todos os deals) em vez de 2 por
 * negócio — usado no painel do contato/deal, que pode ter vários cards.
 */
export async function getInboxLeadPanelFieldsForDeals(
  dealIds: string[]
): Promise<Record<string, InboxLeadPanelFieldRow[]>> {
  const result: Record<string, InboxLeadPanelFieldRow[]> = {};
  if (dealIds.length === 0) return result;

  const fields = await prisma.customField.findMany({
    where: { entity: "deal", showInInboxLeadPanel: true },
  });
  fields.sort(
    (a, b) =>
      (a.inboxLeadPanelOrder ?? 9999) - (b.inboxLeadPanelOrder ?? 9999) ||
      a.label.localeCompare(b.label, "pt-BR")
  );
  if (fields.length === 0) return result;

  const fieldIds = fields.map((f) => f.id);
  const values = await prisma.dealCustomFieldValue.findMany({
    where: { dealId: { in: dealIds }, customFieldId: { in: fieldIds } },
    select: { dealId: true, customFieldId: true, value: true },
  });

  const byDeal = new Map<string, Map<string, string>>();
  for (const v of values) {
    let m = byDeal.get(v.dealId);
    if (!m) {
      m = new Map<string, string>();
      byDeal.set(v.dealId, m);
    }
    m.set(v.customFieldId, v.value);
  }

  for (const dealId of dealIds) {
    const valueByField = byDeal.get(dealId) ?? new Map<string, string>();
    result[dealId] = fields.map((f) => {
      const value = valueByField.get(f.id) ?? null;
      return {
        fieldId: f.id,
        name: f.name,
        label: f.label,
        type: f.type,
        options: f.options,
        value,
        highlightRules: Array.isArray(f.highlightRules) ? f.highlightRules : [],
        highlight: resolveHighlight(value, f.highlightRules),
      };
    });
  }

  return result;
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
            // pipelineId é incluído via stage.pipelineId — Deal não tem
            // pipelineId direto no schema. O frontend (contact-aside +
            // inbox v2) usa `stageName`/`pipelineId` flat, então o map
            // de retorno achata para esse formato.
            stage: { select: { id: true, name: true, color: true, pipelineId: true } },
            owner: { select: assignedToSelect },
          },
        }),
      [] as Awaited<
        ReturnType<
          typeof prisma.deal.findMany<{
            include: {
              stage: { select: { id: true; name: true; color: true; pipelineId: true } };
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
            channelRef: { select: { id: true, name: true, type: true, phoneNumber: true } },
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
              channelRef: { select: { id: true; name: true; type: true; phoneNumber: true } };
            };
          }>
        >
      >,
    ),
    safe("inboxLeadPanelFields", () => getInboxLeadPanelFieldsForContact(id), [] as InboxLeadPanelFieldRow[]),
  ]);

  // Campos de painel de TODOS os negócios do contato (não só o "primeiro
  // aberto"). O frontend abre um negócio específico e busca
  // `dealInboxPanelFields[dealAberto]` — se preenchêssemos só um negócio, abrir
  // qualquer outro do mesmo contato (ex.: reimport que gerou 2 cards) mostraria
  // a lateral vazia. Batched: 1 query pros defs + 1 pros valores de todos.
  const dealInboxPanelFields: Record<string, InboxLeadPanelFieldRow[]> =
    deals.length > 0
      ? await safe(
          "dealInboxPanelFields",
          () => getInboxLeadPanelFieldsForDeals(deals.map((d) => d.id)),
          {} as Record<string, InboxLeadPanelFieldRow[]>,
        )
      : {};

  return {
    ...core,
    company,
    assignedTo,
    tags,
    activities,
    // Achata `stage.{name,color,pipelineId}` para o formato esperado
    // pelo frontend (`stageName`, `stageColor`, `pipelineId`). Sem isso
    // o contact-aside / inbox sidebar mostrava "Sem estágio" mesmo
    // quando o deal tinha stageId válido no banco.
    deals: deals.map((d) => ({
      ...d,
      value: dealValueToString(d.value),
      stageName: d.stage?.name ?? null,
      stageColor: d.stage?.color ?? null,
      pipelineId: d.stage?.pipelineId ?? null,
    })),
    notes,
    conversations,
    inboxLeadPanelFields,
    dealInboxPanelFields,
  };
}

/**
 * Retorna o próximo número sequencial de contato para a organização corrente.
 * Usado em conjunto com retry em P2002 para lidar com corridas concorrentes.
 */
export async function nextContactNumber(): Promise<number> {
  const r = await prisma.contact.aggregate({ _max: { number: true } });
  return (r._max.number ?? 0) + 1;
}

const CONTACT_NUMBER_MAX_RETRIES = 5;

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

/**
 * Busca o id de um contato existente (na org atual) por telefone, tolerando
 * diferenças de formato e a ambiguidade do 9º dígito BR. Requer que os
 * telefones estejam gravados em E.164 (garantido por `createContact`/
 * `updateContact` + backfill `scripts/backfill-phone-e164.mjs`).
 */
export async function findContactIdByPhone(
  orgId: string,
  rawPhone: string | null | undefined,
): Promise<string | null> {
  const variants = phoneMatchVariants(rawPhone);
  if (variants.length === 0) return null;
  const c = await prisma.contact.findFirst({
    where: { organizationId: orgId, phone: { in: variants } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return c?.id ?? null;
}

export async function createContact(data: CreateContactInput) {
  // Normaliza o telefone para E.164 na gravação — garante que webhook e
  // importação gravem no mesmo formato e que o matching por variantes
  // funcione. Se não for normalizável, preserva o valor cru (não perde dado).
  const normalizedPhone =
    data.phone == null ? data.phone : normalizePhone(data.phone) ?? data.phone;
  let lastErr: unknown;
  for (let attempt = 0; attempt < CONTACT_NUMBER_MAX_RETRIES; attempt++) {
    const number = await nextContactNumber();
    try {
      const created = await prisma.contact.create({
        data: withOrgFromCtx({
          ...(data.id ? { id: data.id } : {}),
          number,
          name: data.name,
          externalId: data.externalId === undefined ? undefined : data.externalId,
          email: data.email ?? undefined,
          phone: normalizedPhone ?? undefined,
          avatarUrl: data.avatarUrl ?? undefined,
          leadScore: data.leadScore ?? undefined,
          lifecycleStage: data.lifecycleStage ?? undefined,
          source: data.source ?? undefined,
          companyId: data.companyId ?? undefined,
          assignedToId: data.assignedToId ?? undefined,
        }),
        include: {
          company: { select: { id: true, name: true, domain: true } },
          tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
          assignedTo: { select: assignedToSelect },
        },
      });

      void logEvent({
        type: "CONTACT_CREATED",
        entityType: "CONTACT",
        entityId: created.id,
        entityLabel: created.name ?? created.phone ?? created.email ?? null,
        contactId: created.id,
        meta: {
          email: created.email,
          phone: created.phone,
          source: data.source ?? null,
        },
      });

      return created;
    } catch (err) {
      if (isPrismaUniqueViolation(err) && attempt < CONTACT_NUMBER_MAX_RETRIES - 1) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function updateContact(id: string, data: UpdateContactInput) {
  const updateData: Prisma.ContactUpdateInput = {};

  // Snapshot anterior para diff (somente os campos que podem mudar).
  const prev = await prisma.contact.findUnique({
    where: { id },
    select: {
      name: true,
      email: true,
      phone: true,
      avatarUrl: true,
      leadScore: true,
      lifecycleStage: true,
      source: true,
      companyId: true,
      assignedToId: true,
      externalId: true,
    },
  });

  if (data.name !== undefined) updateData.name = data.name;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.phone !== undefined) {
    // Normaliza para E.164; preserva o valor cru se não for normalizável.
    updateData.phone = data.phone == null ? data.phone : normalizePhone(data.phone) ?? data.phone;
  }
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

  const updated = await prisma.contact.update({
    where: { id },
    data: updateData,
    include: {
      company: { select: { id: true, name: true, domain: true } },
      tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
      assignedTo: { select: assignedToSelect },
    },
  });

  // Diff -> 1 evento por campo alterado.
  if (prev) {
    const NATIVE_FIELDS: Array<{ key: keyof typeof prev; label: string }> = [
      { key: "name", label: "Nome" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Telefone" },
      { key: "leadScore", label: "Lead score" },
      { key: "lifecycleStage", label: "Estágio de ciclo" },
      { key: "source", label: "Origem" },
      { key: "companyId", label: "Empresa" },
      { key: "externalId", label: "ID externo" },
    ];
    for (const f of NATIVE_FIELDS) {
      const before = prev[f.key];
      const after = (updated as Record<string, unknown>)[f.key as string];
      if (before === after) continue;
      if (before == null && after == null) continue;
      void logEvent({
        type: "CONTACT_FIELD_CHANGED",
        entityType: "CONTACT",
        entityId: id,
        entityLabel: updated.name ?? updated.phone ?? updated.email ?? null,
        contactId: id,
        field: String(f.key),
        oldValue: before == null ? null : String(before),
        newValue: after == null ? null : String(after),
        meta: { field: String(f.key), label: f.label },
      });
    }
    // Mudanca de responsavel — evento dedicado.
    if (data.assignedToId !== undefined && prev.assignedToId !== data.assignedToId) {
      void logEvent({
        type: "CONTACT_OWNER_CHANGED",
        entityType: "CONTACT",
        entityId: id,
        entityLabel: updated.name ?? updated.phone ?? updated.email ?? null,
        contactId: id,
        field: "assignedToId",
        oldValue: prev.assignedToId,
        newValue: data.assignedToId ?? null,
        meta: { from: prev.assignedToId, to: data.assignedToId ?? null },
      });
    }
  }

  return updated;
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
