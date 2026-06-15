import { Prisma, type DealRole, type DealStatus } from "@prisma/client";

import { prisma, type ScopedTx } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { getOrgIdOrThrow } from "@/lib/request-context";
import { logEvent } from "@/services/activity-log";
import { getStageMetrics } from "@/services/analytics";
import { enrichContactsWithUserAvatarFallback } from "@/lib/contact-avatar-fallback";
import {
  buildDealWhereFromFilters,
  type AdvancedDealFilters,
} from "@/services/kanban-filters";

export function isValidDealStatus(v: string): v is DealStatus {
  return v === "OPEN" || v === "WON" || v === "LOST";
}

/**
 * Cria um `DealEvent` (log legado) E um `ActivityEvent` (log novo) para
 * o mesmo evento. Mantida a assinatura original para nao quebrar os
 * ~30 call sites existentes em routes/services.
 *
 * Quando todas as features da UI estiverem apontando para `activity_events`,
 * a escrita em `deal_events` pode ser removida e este wrapper passa a
 * delegar apenas para `logEvent`. Por ora mantemos os dois para que
 * panels existentes (timeline) continuem funcionando durante o cutover.
 *
 * Extrai `field/oldValue/newValue` do `meta` (chaves `from`/`to`/`field`
 * sao convencao em quase todos os call sites) para popular as colunas
 * dedicadas do novo log.
 */
export function createDealEvent(
  dealId: string,
  userId: string | null,
  type: string,
  meta: Record<string, unknown> = {},
) {
  const metaJson = meta as Prisma.InputJsonValue;

  // Extrai field/old/new do meta (convencao herdada do log antigo).
  const field =
    typeof meta.field === "string"
      ? (meta.field as string)
      : typeof meta.fieldKey === "string"
        ? (meta.fieldKey as string)
        : null;
  const oldValue =
    meta.from !== undefined && meta.from !== null
      ? String(meta.from)
      : meta.oldValue !== undefined && meta.oldValue !== null
        ? String(meta.oldValue)
        : null;
  const newValue =
    meta.to !== undefined && meta.to !== null
      ? String(meta.to)
      : meta.newValue !== undefined && meta.newValue !== null
        ? String(meta.newValue)
        : null;

  // Fire-and-forget para o novo log — falhas nao afetam o legado.
  void logEvent({
    type,
    entityType: "DEAL",
    entityId: dealId,
    dealId,
    field,
    oldValue,
    newValue,
    meta,
  });

  return prisma.dealEvent
    .create({ data: withOrgFromCtx({ dealId, userId, type, meta: metaJson }) })
    .catch(() =>
      prisma.dealEvent.create({
        data: withOrgFromCtx({ dealId, userId: null, type, meta: metaJson }),
      }),
    );
}

export type GetDealsParams = {
  pipelineId?: string;
  stageId?: string;
  status?: DealStatus;
  ownerId?: string;
  search?: string;
  /**
   * Match EXATO pelo email do contato dono do deal (case-insensitive).
   * Espelha o pattern `emailExact` de `getContacts` — pensado para que
   * integrações respondam "esse cliente tem deal aberto?" sem precisar
   * fazer GET de contacts antes.
   */
  contactEmail?: string;
  /** Match EXATO pelo telefone do contato (tolerante a formatação). */
  contactPhone?: string;
  /** Match direto por contactId — útil quando o caller já tem o id resolvido. */
  contactId?: string;
  page?: number;
  perPage?: number;
  visibilityWhere?: Prisma.DealWhereInput;
  /**
   * Escopo de funis por usuário. `null/undefined` → sem restrição; array
   * (mesmo vazio) → restringe deals aos estágios desses funis.
   */
  allowedPipelineIds?: string[] | null;
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
  if (params.allowedPipelineIds) {
    conditions.push({ stage: { pipelineId: { in: params.allowedPipelineIds } } });
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

  if (params.contactId) {
    conditions.push({ contactId: params.contactId });
  }

  const contactEmail = params.contactEmail?.trim().toLowerCase();
  if (contactEmail) {
    conditions.push({
      contact: { email: { equals: contactEmail, mode: "insensitive" } },
    });
  }

  const contactPhoneRaw = params.contactPhone?.trim();
  if (contactPhoneRaw) {
    const digits = contactPhoneRaw.replace(/\D/g, "");
    const phoneOr: Prisma.ContactWhereInput[] = [{ phone: { equals: contactPhoneRaw } }];
    if (digits && digits.length >= 8) {
      phoneOr.push({ phone: { endsWith: digits } });
    }
    conditions.push({
      contact: phoneOr.length === 1 ? phoneOr[0] : { OR: phoneOr },
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
      id: true, number: true, name: true, email: true, phone: true, avatarUrl: true,
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

export type DealDetail = Prisma.DealGetPayload<{
  include: typeof detailInclude;
}>;

export async function getDealById(idOrNumber: string): Promise<DealDetail | null> {
  const isNumeric = /^\d+$/.test(idOrNumber);
  const orgId = getOrgIdOrThrow();
  const deal = (await prisma.deal.findUnique({
    where: isNumeric
      ? { organizationId_number: { organizationId: orgId, number: parseInt(idOrNumber, 10) } }
      : { id: idOrNumber },
    include: detailInclude,
  })) as DealDetail | null;
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
  /** Papel do deal (PRD catálogo): default COMMERCIAL no schema. */
  dealRole?: DealRole;
};

/**
 * Calcula o proximo `Deal.number` da org corrente. O schema declara
 * `@@unique([organizationId, number])` e o campo nao tem default — antes
 * era autoincrement global, mas multi-tenancy partiu por org e Postgres
 * sequences nao suportam particionamento. A extension Prisma escopa o
 * aggregate por org via getOrgIdOrThrow(), entao isso ja vem isolado.
 *
 * Em caso de corrida (dois creates simultaneos resolvendo o mesmo
 * `max+1`), o caller deve fazer retry em P2002 — ver `createDeal` abaixo.
 */
export async function nextDealNumber(): Promise<number> {
  const r = await prisma.deal.aggregate({ _max: { number: true } });
  return (r._max.number ?? 0) + 1;
}

const DEAL_NUMBER_MAX_RETRIES = 5;

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

export async function createDeal(data: CreateDealInput) {
  const title = data.title.trim();
  if (!title) throw new Error("INVALID_TITLE");

  const maxPos = await prisma.deal.aggregate({
    where: { stageId: data.stageId },
    _max: { position: true },
  });
  const position = data.position ?? (maxPos._max.position ?? -1) + 1;

  // `number` e mandatorio (sem default) e unico por org. Tentamos
  // alocar max+1 e repetimos em P2002 para cobrir corridas concorrentes
  // (ex.: dois usuarios da mesma org criando deal no mesmo segundo).
  let lastErr: unknown;
  for (let attempt = 0; attempt < DEAL_NUMBER_MAX_RETRIES; attempt++) {
    const number = await nextDealNumber();
    try {
      return await prisma.deal.create({
        data: withOrgFromCtx({
          ...(data.id ? { id: data.id } : {}),
          number,
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
          dealRole: data.dealRole === undefined ? undefined : data.dealRole,
        }),
        include: listInclude,
      });
    } catch (err) {
      lastErr = err;
      if (isPrismaUniqueViolation(err)) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("Falha ao alocar Deal.number apos retries");
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
  // Importante: usar UncheckedUpdateInput evita conflito com a extension
  // multi-tenant que injeta `organizationId` em `data` no update.
  // No checked input (`DealUpdateInput`), `organizationId` não é aceito.
  const payload: Prisma.DealUncheckedUpdateInput = {};

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
  if (data.contactId !== undefined) payload.contactId = data.contactId;
  if (data.stageId !== undefined) payload.stageId = data.stageId;
  if (data.ownerId !== undefined) payload.ownerId = data.ownerId;
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
  tx: ScopedTx,
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
  //
  // IMPORTANTE (bug de NULL/SQL): tanto `NOT: { assignedToId: ownerId }`
  // quanto `assignedToId: { not: ownerId }` EXCLUEM linhas com
  // `assignedToId = NULL` (semântica de três valores do SQL: `NULL <> 'x'`
  // não é TRUE). Resultado do bug: conversa SEM responsável nunca recebia o
  // assignee da distribuição/automação → inbox seguia "Sem responsável".
  // Por isso incluímos explicitamente as conversas com `assignedToId = NULL`.
  const changedWhere: Prisma.ConversationWhereInput =
    ownerId === null
      ? { contactId, assignedToId: { not: null } }
      : {
          contactId,
          OR: [{ assignedToId: null }, { assignedToId: { not: ownerId } }],
        };
  await tx.conversation.updateMany({
    where: changedWhere,
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

/**
 * Sincroniza `Deal.status` com o estágio de destino (modelo Kommo):
 *   - estágio `isWon`  → status WON  + closedAt
 *   - estágio `isLost` → status LOST + closedAt (+ lostReason se vier)
 *   - estágio comum    → status OPEN (reabre se estava fechado)
 * Retorna o patch a aplicar junto com a mudança de stage (vazio se o
 * status já está coerente).
 */
function buildStatusSyncPatch(
  currentStatus: DealStatus,
  targetStage: { isWon: boolean; isLost: boolean },
  lostReason?: string | null,
): Prisma.DealUncheckedUpdateInput {
  if (targetStage.isWon) {
    return currentStatus === "WON"
      ? {}
      : { status: "WON", closedAt: new Date(), lostReason: null };
  }
  if (targetStage.isLost) {
    const reason = lostReason?.trim() || null;
    if (currentStatus === "LOST") {
      // Já perdido: só atualiza o motivo se um novo foi informado.
      return reason ? { lostReason: reason } : {};
    }
    return { status: "LOST", closedAt: new Date(), lostReason: reason };
  }
  return currentStatus === "OPEN"
    ? {}
    : { status: "OPEN", closedAt: null, lostReason: null };
}

export type MoveDealOptions = {
  /** Motivo da perda — usado quando o destino é o estágio Perdido. */
  lostReason?: string | null;
};

export async function moveDeal(
  dealId: string,
  targetStageId: string,
  position: number,
  options?: MoveDealOptions,
) {
  if (!Number.isInteger(position) || position < 0) {
    throw new Error("INVALID_POSITION");
  }

  let becameWon = false;
  let becameLost = false;
  const result = await prisma.$transaction(async (tx) => {
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
    const statusPatch = buildStatusSyncPatch(deal.status, targetStage, options?.lostReason);
    becameWon = deal.status !== "WON" && targetStage.isWon;
    becameLost = deal.status !== "LOST" && targetStage.isLost;

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
          data: ordered[i].id === dealId ? { position: i, ...statusPatch } : { position: i },
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
      data: { stageId: targetStageId, position, ...statusPatch },
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

  // Pós-commit (fire-and-forget; import dinâmico evita ciclo de módulos):
  if (becameWon) {
    void import("@/services/product-fulfillment").then((m) => m.onDealWon(dealId));
    // Catálogo por capacidades (PRD): operação pós-venda agnóstica.
    void import("@/services/fulfillment").then((m) => m.onCommercialDealWon(dealId));
  } else if (becameLost) {
    void import("@/services/product-fulfillment").then((m) =>
      m.onDealReverted(dealId),
    );
  }
  // Funil B2C de candidatos: reserva/contratação ao entrar nos estágios da vaga.
  void import("@/services/product-fulfillment").then((m) =>
    m.onCandidateStageMove(dealId, targetStageId).catch((err) => {
      console.warn("[deals.moveDeal] onCandidateStageMove falhou:", {
        dealId,
        targetStageId,
        err: err instanceof Error ? err.message : String(err),
      });
    }),
  );
  return result;
}

/**
 * Resolve o estágio terminal (Ganho ou Perdido) do pipeline do deal e o
 * patch de movimentação pra ele (append no fim da coluna). Retorna {}
 * quando o deal já está no terminal certo ou o pipeline (legado) não
 * tem o estágio fixo.
 */
async function buildTerminalStageMovePatch(
  tx: ScopedTx,
  deal: { stageId: string },
  kind: "won" | "lost",
): Promise<Prisma.DealUncheckedUpdateInput> {
  const current = await tx.stage.findUnique({
    where: { id: deal.stageId },
    select: { pipelineId: true, isWon: true, isLost: true },
  });
  if (!current) return {};
  if (kind === "won" ? current.isWon : current.isLost) return {};

  const target = await tx.stage.findFirst({
    where: { pipelineId: current.pipelineId, ...(kind === "won" ? { isWon: true } : { isLost: true }) },
    select: { id: true },
  });
  if (!target) return {};

  const max = await tx.deal.aggregate({
    where: { stageId: target.id },
    _max: { position: true },
  });
  return { stageId: target.id, position: (max._max.position ?? -1) + 1 };
}

export async function markDealWon(id: string) {
  const result = await prisma.$transaction(async (tx) => {
    const deal = await tx.deal.findUnique({ where: { id }, select: { stageId: true } });
    if (!deal) throw new Error("NOT_FOUND");
    const movePatch = await buildTerminalStageMovePatch(tx, deal, "won");
    return tx.deal.update({
      where: { id },
      data: {
        status: "WON",
        closedAt: new Date(),
        lostReason: null,
        ...movePatch,
      },
      include: listInclude,
    });
  });
  // Pós-commit (fire-and-forget; import dinâmico evita ciclo deals<->fulfillment).
  void import("@/services/product-fulfillment").then((m) => m.onDealWon(id));
  // Catálogo por capacidades (PRD): operação pós-venda agnóstica.
  void import("@/services/fulfillment").then((m) => m.onCommercialDealWon(id));
  return result;
}

export async function markDealLost(id: string, lostReason?: string | null) {
  // Obrigatoriedade do motivo é decidida na rota (org setting
  // `deals.loss_reason_required`); aqui aceitamos vazio → null.
  const reason = lostReason?.trim() || null;

  const result = await prisma.$transaction(async (tx) => {
    const deal = await tx.deal.findUnique({ where: { id }, select: { stageId: true } });
    if (!deal) throw new Error("NOT_FOUND");
    const movePatch = await buildTerminalStageMovePatch(tx, deal, "lost");
    return tx.deal.update({
      where: { id },
      data: {
        status: "LOST",
        closedAt: new Date(),
        lostReason: reason,
        ...movePatch,
      },
      include: listInclude,
    });
  });
  // Perda: estorna alocações (no-op se não houver; cobre "desistência" no funil B2C).
  void import("@/services/product-fulfillment").then((m) => m.onDealReverted(id));
  return result;
}

export async function reopenDeal(id: string) {
  const result = await prisma.$transaction(async (tx) => {
    const deal = await tx.deal.findUnique({ where: { id }, select: { stageId: true } });
    if (!deal) throw new Error("NOT_FOUND");

    // Se o deal está num estágio terminal, reabrir o devolve pro último
    // estágio operacional do pipeline (o mais próximo do fechamento).
    let movePatch: Prisma.DealUncheckedUpdateInput = {};
    const current = await tx.stage.findUnique({
      where: { id: deal.stageId },
      select: { pipelineId: true, isWon: true, isLost: true },
    });
    if (current && (current.isWon || current.isLost)) {
      const target = await tx.stage.findFirst({
        where: { pipelineId: current.pipelineId, isWon: false, isLost: false },
        orderBy: { position: "desc" },
        select: { id: true },
      });
      if (target) {
        const max = await tx.deal.aggregate({
          where: { stageId: target.id },
          _max: { position: true },
        });
        movePatch = { stageId: target.id, position: (max._max.position ?? -1) + 1 };
      }
    }

    return tx.deal.update({
      where: { id },
      data: {
        status: "OPEN",
        closedAt: null,
        lostReason: null,
        ...movePatch,
      },
      include: listInclude,
    });
  });
  // Reabertura: estorna alocações consumidas no ganho (lança inversos).
  void import("@/services/product-fulfillment").then((m) => m.onDealReverted(id));
  return result;
}

/** Limite default de cards exibidos por coluna no board. */
const DEFAULT_BOARD_COLUMN_LIMIT = 100;
const MAX_BOARD_COLUMN_LIMIT = 500;

/**
 * Critério de ordenação dos cards dentro de cada coluna do board.
 *
 * - `position` (default): ordem manual definida por drag-and-drop.
 *   Preserva o comportamento histórico do Kanban (cada deal carrega
 *   um inteiro `position` mantido pelas mutações de DnD).
 * - `createdAt`: ordena pelo timestamp de criação do deal. Usado pelas
 *   opções "Criação: mais recente" / "Criação: mais antigo" do menu
 *   kebab do Kanban no frontend (`_v2-client.tsx`). Cobre TODOS os
 *   cards da coluna porque o orderBy roda antes do `take` do Prisma —
 *   ao contrário do sort client-side antigo, que só ordenava os deals
 *   já carregados (default 100 por coluna).
 * - `lastInteraction`: ordena pela última interação na conversa do
 *   contato vinculado ao deal (`MAX(Conversation.updatedAt)` do
 *   contato). Como o Deal não tem campo desnormalizado, esse sort
 *   percorre um caminho próprio (`loadBoardStagesByLastInteraction`):
 *   busca IDs leves de todos os deals que casam com o filtro,
 *   agrega o último `updatedAt` por contato via `groupBy`, ordena
 *   e pagina em memória, e só então faz o `findMany` completo dos
 *   IDs paginados. Deals sem contato/conversa ficam no fim
 *   (`nulls last`) em ambas as direções; `position` é tiebreaker.
 */
export type BoardSortField = "position" | "createdAt" | "lastInteraction";
export type BoardSortDirection = "asc" | "desc";

function buildBoardDealOrderBy(
  sortField: BoardSortField | undefined,
  sortDirection: BoardSortDirection | undefined,
): Prisma.DealOrderByWithRelationInput[] {
  if (sortField === "createdAt") {
    const dir: BoardSortDirection = sortDirection === "desc" ? "desc" : "asc";
    // `position` como tiebreaker mantém ordem estável quando vários
    // deals têm o mesmo timestamp (importações em lote, seeds).
    return [{ createdAt: dir }, { position: "asc" }];
  }
  // `lastInteraction` não cai aqui — segue por caminho próprio em
  // `loadBoardStagesByLastInteraction`. Fallback estável.
  return [{ position: "asc" }];
}

/** Campos do Deal incluídos em cada card do board. Reusado pelo caminho
 *  default (Prisma include) e pelo caminho `lastInteraction`
 *  (findMany separado dos IDs paginados). */
const BOARD_DEAL_INCLUDE = {
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
} satisfies Prisma.DealInclude;

type BoardStageWithDeals = Prisma.StageGetPayload<{
  include: { deals: { include: typeof BOARD_DEAL_INCLUDE } };
}>;

/**
 * Caminho alternativo do board quando `sortField === "lastInteraction"`.
 *
 * Por que separado: o Prisma não suporta ordenar `Deal` por agregação
 * de uma relação distante (`Deal → Contact → Conversations`). A
 * solução é fazer em 3 passos:
 *
 *   1) Lista leve de IDs candidatos por stage (apenas
 *      `id, stageId, contactId, position`) respeitando o `where`.
 *   2) `groupBy contactId _max: updatedAt` em `Conversation` para
 *      obter o último timestamp por contato.
 *   3) Ordenar/paginar em memória por stage e buscar os deals
 *      completos via `findMany({ where: { id: { in: ids } } })`.
 *
 * Custos: 3 queries Prisma (vs 1 do caminho default), mas a 1ª e a 2ª
 * trazem só colunas leves. Para até alguns milhares de deals por org
 * o overhead é desprezível. Se ficar pesado, o passo recomendado é
 * desnormalizar `Deal.lastInteractionAt` e migrar pro caminho default.
 */
async function loadBoardStagesByLastInteraction(
  pipelineId: string,
  dealWhere: Prisma.DealWhereInput,
  perStage: number,
  offsetByStage: Record<string, number>,
  direction: BoardSortDirection,
): Promise<BoardStageWithDeals[]> {
  const stagesRaw = await prisma.stage.findMany({
    where: { pipelineId },
    orderBy: { position: "asc" },
  });
  if (stagesRaw.length === 0) return [];

  const stageIds = stagesRaw.map((s) => s.id);
  const candidates = await prisma.deal.findMany({
    where: { ...dealWhere, stageId: { in: stageIds } },
    select: { id: true, stageId: true, contactId: true, position: true },
  });

  const contactIds = Array.from(
    new Set(
      candidates
        .map((c) => c.contactId)
        .filter((id): id is string => id !== null),
    ),
  );

  const lastByContact = new Map<string, Date>();
  if (contactIds.length > 0) {
    const groups = await prisma.conversation.groupBy({
      by: ["contactId"],
      where: { contactId: { in: contactIds } },
      _max: { updatedAt: true },
    });
    for (const g of groups) {
      if (g._max.updatedAt) lastByContact.set(g.contactId, g._max.updatedAt);
    }
  }

  // Agrupa candidatos por stage e ordena cada grupo.
  type Candidate = (typeof candidates)[number];
  const byStage = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const arr = byStage.get(c.stageId);
    if (arr) arr.push(c);
    else byStage.set(c.stageId, [c]);
  }
  const cmp = (a: Candidate, b: Candidate) => {
    const aLast = a.contactId ? lastByContact.get(a.contactId) : undefined;
    const bLast = b.contactId ? lastByContact.get(b.contactId) : undefined;
    // Nulls last em AMBAS as direções: deals sem conversa nunca devem
    // ficar no topo, independentemente de "mais recente" ou "mais antigo".
    if (!aLast && !bLast) return a.position - b.position;
    if (!aLast) return 1;
    if (!bLast) return -1;
    const diff = aLast.getTime() - bLast.getTime();
    if (diff !== 0) return direction === "desc" ? -diff : diff;
    return a.position - b.position;
  };

  const paginatedIdsByStage = new Map<string, string[]>();
  for (const [stageId, items] of byStage) {
    items.sort(cmp);
    const extra = offsetByStage[stageId] ?? 0;
    const limit = perStage + extra;
    paginatedIdsByStage.set(stageId, items.slice(0, limit).map((d) => d.id));
  }

  const allPaginatedIds = Array.from(paginatedIdsByStage.values()).flat();
  const dealsLoaded =
    allPaginatedIds.length === 0
      ? []
      : await prisma.deal.findMany({
          where: { id: { in: allPaginatedIds } },
          include: BOARD_DEAL_INCLUDE,
        });
  const dealById = new Map(dealsLoaded.map((d) => [d.id, d]));

  return stagesRaw.map((stage) => {
    const ids = paginatedIdsByStage.get(stage.id) ?? [];
    const deals = ids
      .map((id) => dealById.get(id))
      .filter((d): d is NonNullable<typeof d> => Boolean(d));
    return { ...stage, deals };
  });
}

export type BoardLimitOptions = {
  /** Quantos cards retornar por coluna. */
  perStage?: number;
  /** Offset por etapa: stageId -> quantos pular. Permite "Carregar mais". */
  offsetByStage?: Record<string, number>;
  /** Campo de ordenação dentro de cada coluna. Default: `position`. */
  sortField?: BoardSortField;
  /** Direção da ordenação. Default: `asc`. */
  sortDirection?: BoardSortDirection;
};

export async function getBoardData(
  pipelineId: string,
  visibilityOwnerId?: string | null,
  statusFilter?: DealStatus | "ALL",
  advancedFilters?: AdvancedDealFilters,
  limitOptions?: BoardLimitOptions,
) {
  const now = new Date();

  const conditions: Prisma.DealWhereInput[] = [];

  if (statusFilter && statusFilter !== "ALL") {
    conditions.push({ status: statusFilter });
  } else if (!statusFilter) {
    conditions.push({ status: "OPEN" });
  }
  if (visibilityOwnerId) {
    conditions.push({ ownerId: visibilityOwnerId });
  }

  if (advancedFilters && Object.keys(advancedFilters).length > 0) {
    // pipelineId/statuses no advancedFilters não substituem visibilidade —
    // ficam como condições adicionais (AND).
    const advConditions = await buildDealWhereFromFilters(advancedFilters);
    for (const c of advConditions) conditions.push(c);
  }

  const dealWhere: Prisma.DealWhereInput =
    conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : { AND: conditions };

  const perStage = Math.min(
    MAX_BOARD_COLUMN_LIMIT,
    Math.max(1, limitOptions?.perStage ?? DEFAULT_BOARD_COLUMN_LIMIT),
  );
  const offsetByStage = limitOptions?.offsetByStage ?? {};
  const sortField = limitOptions?.sortField;
  const sortDirection: BoardSortDirection =
    limitOptions?.sortDirection === "desc" ? "desc" : "asc";
  // Construído uma vez e reusado nas 2 queries de deals (stages.deals
  // + branch de "Carregar mais"). Default cai em `position asc` =
  // comportamento histórico.
  const dealOrderBy = buildBoardDealOrderBy(sortField, sortDirection);

  let stages: BoardStageWithDeals[];

  if (sortField === "lastInteraction") {
    // Caminho dedicado: ordena por `MAX(Conversation.updatedAt)` do
    // contato. Já aplica `offsetByStage` internamente (não cai no
    // branch de "Carregar mais" abaixo).
    stages = await loadBoardStagesByLastInteraction(
      pipelineId,
      dealWhere,
      perStage,
      offsetByStage,
      sortDirection,
    );
  } else {
    // 1) Etapas + cards. Para evitar problemas de UX em "Carregar mais",
    //    quando uma etapa tem `extraLoaded > 0`, retornamos `perStage + extraLoaded`
    //    (acumulado). O frontend continua vendo todos os cards já carregados.
    stages = await prisma.stage.findMany({
      where: { pipelineId },
      orderBy: { position: "asc" },
      include: {
        deals: {
          where: dealWhere,
          orderBy: dealOrderBy,
          take: perStage,
          include: BOARD_DEAL_INCLUDE,
        },
      },
    });

    // 2) Para etapas com extra carregado > 0, substitui pelo conjunto acumulado.
    const stageIdsWithOffset = Object.keys(offsetByStage).filter(
      (id) => (offsetByStage[id] ?? 0) > 0,
    );
    if (stageIdsWithOffset.length > 0) {
      for (const stageId of stageIdsWithOffset) {
        const extra = offsetByStage[stageId] ?? 0;
        const expanded = await prisma.deal.findMany({
          where: { ...dealWhere, stageId },
          orderBy: dealOrderBy,
          take: perStage + extra,
          include: BOARD_DEAL_INCLUDE,
        });
        const idx = stages.findIndex((s) => s.id === stageId);
        if (idx >= 0) stages[idx] = { ...stages[idx], deals: expanded };
      }
    }
  }

  // 3) Contagem TOTAL por etapa (independente do limit) — usada pra exibir
  //    "+N mais" e os totais reais por coluna.
  const totalsByStage = new Map<string, number>();
  if (stages.length > 0) {
    const groups = await prisma.deal.groupBy({
      by: ["stageId"],
      where: { ...dealWhere, stageId: { in: stages.map((s) => s.id) } },
      _count: { _all: true },
    });
    for (const g of groups) totalsByStage.set(g.stageId, g._count._all);
  }

  const allDealIds = stages.flatMap((s) => s.deals.map((d) => d.id));
  const allContactIds = stages
    .flatMap((s) => s.deals)
    .map((d) => d.contactId)
    .filter((id): id is string => !!id);

  // Product names per deal
  const productMap = new Map<string, string>();
  const productTypeMap = new Map<string, string>();
  if (allDealIds.length > 0) {
    const orgId = getOrgIdOrThrow();
    const dealProducts = await prisma.$queryRaw<{ dealId: string; name: string; type: string }[]>`
      SELECT dp."dealId", p.name, p.type
      FROM deal_products dp
      INNER JOIN products p ON p.id = dp."productId"
      WHERE dp."dealId" = ANY(${allDealIds})
        AND dp."organizationId" = ${orgId}
        AND p."organizationId" = ${orgId}
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

  // Stage `isIncoming` (Leads de entrada) é a fase de captura e DEVE
  // ficar sempre visível. Antes filtrávamos por `stage.deals.length > 0`,
  // mas esse array é a slice PÓS-filtro (status=OPEN padrão, visibility,
  // filtros avançados). Qualquer filtro ativo escondia a coluna inteira
  // mesmo havendo leads no banco — bug reportado: "existem leads em
  // leads de entrada, mas a fase do funil não aparece".
  return stages
    .map((stage) => {
      const metric = metricsMap.get(stage.id);
      const totalCount = totalsByStage.get(stage.id) ?? stage.deals.length;
      // `extra` agora representa "quantos cards adicionais foram pedidos".
      // O total carregado é o tamanho real do array.
      const loadedCount = stage.deals.length;
      const hasMore = loadedCount < totalCount;
      return {
        ...stage,
        conversionRate: metric?.conversionRate ?? 0,
        avgDaysInStage: metric?.avgDaysInStage ?? 0,
        totalCount,
        loadedCount,
        hasMore,
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
