/**
 * Dashboard comercial (Fase 1).
 *
 * Agrega cards + seções principais (funil por etapa, negócios por origem,
 * ranking de consultores) respeitando os filtros comerciais: período,
 * tags, origem (Contact.source), responsável (Deal.ownerId), pipeline e
 * etapa.
 *
 * Reaproveita `buildDealWhereFromFilters` (kanban) para traduzir os
 * filtros estruturais em `Prisma.DealWhereInput` — sem arquitetura
 * paralela. A dimensão de origem é tratada localmente porque precisamos
 * suportar "Sem origem" (Contact.source null/"" ou deal sem contato),
 * caso que o builder do kanban não cobre.
 *
 * Escopo de organização: usamos métodos de modelo via `analyticsClient()`
 * (read replica quando configurada), que já injetam `organizationId` pela
 * extension de tenant. Não há SQL cru nesta fase.
 *
 * Semântica de período (alinhada ao schema, que NÃO tem wonAt/lostAt):
 *   - Em andamento / valor do funil / contagem por etapa: status = OPEN
 *     (snapshot atual, respeitando os filtros estruturais — não limitado
 *     pelas datas).
 *   - Ganhos / perdidos (contagem e valor): status = WON/LOST com
 *     closedAt dentro do período.
 *   - Novos contatos: Contact.createdAt dentro do período.
 *
 * A movimentação histórica por etapa (entered/exited via DealEvent) e
 * leads parados ficam para a Fase 2.
 */

import { Prisma, type DealStatus } from "@prisma/client";

import { analyticsClient } from "@/lib/analytics";
import { getOrgIdOrThrow } from "@/lib/request-context";
import {
  buildDealWhereFromFilters,
  type AdvancedDealFilters,
} from "@/services/kanban-filters";

const prisma = analyticsClient();

/** Sentinela usada no filtro de origem para "Sem origem". */
export const SOURCE_NONE = "__none__";

// ──────────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────────

export interface DashboardFilters {
  from: Date;
  to: Date;
  /** Pipeline já resolvido (default da org quando não informado). */
  pipelineId: string;
  stageIds?: string[];
  tagIds?: string[];
  ownerIds?: string[];
  /** Pode incluir `SOURCE_NONE` para "Sem origem". */
  sources?: string[];
}

export interface DashboardSummary {
  totalValue: number;
  openDeals: number;
  winRate: number;
  avgTicket: number;
  newContacts: number;
  wonCount: number;
  lostCount: number;
  wonValue: number;
  lostValue: number;
  leadsWithoutOwner: number;
  avgTimeToWinDays: number;
  deltas: {
    winRate: number;
    avgTicket: number;
    wonCount: number;
    wonValue: number;
  };
}

export interface DashboardFunnelStage {
  id: string;
  name: string;
  color: string;
  count: number;
  value: number;
  won: number;
  lost: number;
  conversion: number;
  /** Movimentação histórica no período (via DealEvent). */
  entered: number;
  exited: number;
}

export interface DashboardTagRow {
  id: string;
  name: string;
  color: string;
  count: number;
  won: number;
  lost: number;
  conversion: number;
  wonValue: number;
}

export interface DashboardLossReason {
  reason: string;
  count: number;
  value: number;
}

export interface DashboardDailyPoint {
  date: string; // YYYY-MM-DD
  novos: number;
  ganhos: number;
  perdidos: number;
}

export interface DashboardStalledStage {
  id: string;
  name: string;
  color: string;
  count: number;
  value: number;
  rottingDays: number;
}

export interface DashboardSourceRow {
  key: string;
  label: string;
  count: number;
  won: number;
  lost: number;
  conversion: number;
  wonValue: number;
}

export interface DashboardOwnerRow {
  id: string;
  name: string;
  leads: number;
  open: number;
  won: number;
  lost: number;
  conversion: number;
  wonValue: number;
}

export interface DashboardResult {
  pipelineId: string;
  summary: DashboardSummary;
  funnel: DashboardFunnelStage[];
  bySource: DashboardSourceRow[];
  byOwner: DashboardOwnerRow[];
  byTag: DashboardTagRow[];
  lossReasons: DashboardLossReason[];
  dailyEvolution: DashboardDailyPoint[];
  stalled: DashboardStalledStage[];
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function toNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "object" && v !== null && "toNumber" in v) {
    const d = v as { toNumber: () => number };
    if (typeof d.toNumber === "function") return d.toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pctDelta(current: number, previous: number): number {
  if (!previous) return 0;
  return round2(((current - previous) / previous) * 100);
}

function previousPeriod(from: Date, to: Date): { from: Date; to: Date } {
  const span = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - span);
  return { from: prevFrom, to: prevTo };
}

function conversion(won: number, lost: number): number {
  const decided = won + lost;
  return decided > 0 ? round2((won / decided) * 100) : 0;
}

/** Combina as condições estruturais (sem data) com uma condição extra. */
function and(
  structural: Prisma.DealWhereInput[],
  extra: Prisma.DealWhereInput,
): Prisma.DealWhereInput {
  return { AND: [...structural, extra] };
}

/**
 * Condição de origem em cima do contato do deal, com suporte a
 * "Sem origem" (contato com source null/"" ou deal sem contato).
 */
function buildDealSourceCondition(
  sources?: string[],
): Prisma.DealWhereInput | null {
  if (!sources || sources.length === 0) return null;
  const real = sources.filter((s) => s && s !== SOURCE_NONE);
  const wantNone = sources.includes(SOURCE_NONE);
  const or: Prisma.DealWhereInput[] = [];
  if (real.length) or.push({ contact: { is: { source: { in: real } } } });
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

/** Mesma lógica de origem, porém no próprio contato (para "novos contatos"). */
function buildContactSourceCondition(
  sources?: string[],
): Prisma.ContactWhereInput | null {
  if (!sources || sources.length === 0) return null;
  const real = sources.filter((s) => s && s !== SOURCE_NONE);
  const wantNone = sources.includes(SOURCE_NONE);
  const or: Prisma.ContactWhereInput[] = [];
  if (real.length) or.push({ source: { in: real } });
  if (wantNone) or.push({ OR: [{ source: null }, { source: "" }] });
  if (or.length === 0) return null;
  return or.length === 1 ? or[0] : { OR: or };
}

/**
 * Where dos negócios para os filtros estruturais (sem data). Reaproveita
 * o builder do kanban para pipeline/etapa/tags/responsável e adiciona a
 * origem (com "Sem origem").
 */
async function buildStructuralWhere(
  f: DashboardFilters,
): Promise<Prisma.DealWhereInput[]> {
  const adv: AdvancedDealFilters = {};
  if (f.pipelineId) adv.pipelineId = f.pipelineId;
  if (f.stageIds && f.stageIds.length > 0) adv.stageIds = f.stageIds;
  if (f.tagIds && f.tagIds.length > 0) {
    adv.tagIds = f.tagIds;
    adv.tagMode = "any";
  }
  const realOwners = (f.ownerIds ?? []).filter((id): id is string => !!id);
  if (realOwners.length > 0) adv.ownerIds = realOwners;

  const conditions = await buildDealWhereFromFilters(adv);
  const sourceCond = buildDealSourceCondition(f.sources);
  if (sourceCond) conditions.push(sourceCond);
  return conditions;
}

/** Where de contato para o card "novos contatos" (período + origem + tags). */
function buildContactWhere(f: DashboardFilters): Prisma.ContactWhereInput {
  const conds: Prisma.ContactWhereInput[] = [
    { createdAt: { gte: f.from, lte: f.to } },
  ];
  const src = buildContactSourceCondition(f.sources);
  if (src) conds.push(src);
  if (f.tagIds && f.tagIds.length > 0) {
    conds.push({ tags: { some: { tagId: { in: f.tagIds } } } });
  }
  return conds.length === 1 ? conds[0] : { AND: conds };
}

// ──────────────────────────────────────────────────────────────────
// Service principal
// ──────────────────────────────────────────────────────────────────

export async function getDashboard(
  f: DashboardFilters,
): Promise<DashboardResult> {
  const orgId = getOrgIdOrThrow();

  const structural = await buildStructuralWhere(f);
  const prev = previousPeriod(f.from, f.to);

  const openCond: Prisma.DealWhereInput = { status: "OPEN" as DealStatus };
  const createdCond: Prisma.DealWhereInput = {
    createdAt: { gte: f.from, lte: f.to },
  };
  const wonCond: Prisma.DealWhereInput = {
    status: "WON" as DealStatus,
    closedAt: { gte: f.from, lte: f.to },
  };
  const lostCond: Prisma.DealWhereInput = {
    status: "LOST" as DealStatus,
    closedAt: { gte: f.from, lte: f.to },
  };
  const prevWonCond: Prisma.DealWhereInput = {
    status: "WON" as DealStatus,
    closedAt: { gte: prev.from, lte: prev.to },
  };
  const prevLostCond: Prisma.DealWhereInput = {
    status: "LOST" as DealStatus,
    closedAt: { gte: prev.from, lte: prev.to },
  };

  const [
    stages,
    openAgg,
    wonAgg,
    lostAgg,
    prevWonAgg,
    prevLostAgg,
    leadsWithoutOwner,
    wonCycleRows,
    newContacts,
    openByStage,
    wonByStage,
    lostByStage,
    ownerOpen,
    ownerWon,
    ownerLost,
    ownerCreated,
    periodDeals,
    dealIdRows,
    openStallRows,
  ] = await Promise.all([
    prisma.stage.findMany({
      where: { pipelineId: f.pipelineId },
      orderBy: { position: "asc" },
      select: { id: true, name: true, color: true, rottingDays: true },
    }),
    prisma.deal.aggregate({
      where: and(structural, openCond),
      _sum: { value: true },
      _count: true,
    }),
    prisma.deal.aggregate({
      where: and(structural, wonCond),
      _sum: { value: true },
      _avg: { value: true },
      _count: true,
    }),
    prisma.deal.aggregate({
      where: and(structural, lostCond),
      _sum: { value: true },
      _count: true,
    }),
    prisma.deal.aggregate({
      where: and(structural, prevWonCond),
      _sum: { value: true },
      _avg: { value: true },
      _count: true,
    }),
    prisma.deal.aggregate({
      where: and(structural, prevLostCond),
      _count: true,
    }),
    prisma.deal.count({
      where: and(structural, { ...openCond, ownerId: null }),
    }),
    prisma.deal.findMany({
      where: and(structural, wonCond),
      select: { createdAt: true, closedAt: true },
    }),
    prisma.contact.count({ where: buildContactWhere(f) }),
    prisma.deal.groupBy({
      by: ["stageId"],
      where: and(structural, openCond),
      _count: { _all: true },
      _sum: { value: true },
    }),
    prisma.deal.groupBy({
      by: ["stageId"],
      where: and(structural, wonCond),
      _count: { _all: true },
    }),
    prisma.deal.groupBy({
      by: ["stageId"],
      where: and(structural, lostCond),
      _count: { _all: true },
    }),
    prisma.deal.groupBy({
      by: ["ownerId"],
      where: and(structural, openCond),
      _count: { _all: true },
    }),
    prisma.deal.groupBy({
      by: ["ownerId"],
      where: and(structural, wonCond),
      _count: { _all: true },
      _sum: { value: true },
    }),
    prisma.deal.groupBy({
      by: ["ownerId"],
      where: and(structural, lostCond),
      _count: { _all: true },
    }),
    prisma.deal.groupBy({
      by: ["ownerId"],
      where: and(structural, createdCond),
      _count: { _all: true },
    }),
    prisma.deal.findMany({
      where: and(structural, { OR: [createdCond, wonCond, lostCond] }),
      select: {
        status: true,
        value: true,
        createdAt: true,
        closedAt: true,
        lostReason: true,
        contact: { select: { source: true } },
        tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
      },
    }),
    // Ponte p/ o funil histórico: ids dos deals que casam com os filtros
    // estruturais (qualquer status/data), usados no IN do DealEvent.
    prisma.deal.findMany({
      where: { AND: structural },
      select: { id: true },
    }),
    // Leads parados: snapshot de negócios OPEN com updatedAt p/ comparar
    // com o rottingDays de cada etapa.
    prisma.deal.findMany({
      where: and(structural, openCond),
      select: { stageId: true, updatedAt: true, value: true },
    }),
  ]);

  // ── Summary ──────────────────────────────────────────────────────
  const wonCount = openAggCount(wonAgg);
  const lostCount = openAggCount(lostAgg);
  const wonValue = toNumber(wonAgg._sum.value);
  const lostValue = toNumber(lostAgg._sum.value);
  const avgTicket = wonCount > 0 ? round2(toNumber(wonAgg._avg.value)) : 0;
  const winRate = conversion(wonCount, lostCount);

  const prevWonCount = openAggCount(prevWonAgg);
  const prevLostCount = openAggCount(prevLostAgg);
  const prevWinRate = conversion(prevWonCount, prevLostCount);
  const prevAvgTicket =
    prevWonCount > 0 ? round2(toNumber(prevWonAgg._avg.value)) : 0;
  const prevWonValue = toNumber(prevWonAgg._sum.value);

  let avgTimeToWinDays = 0;
  if (wonCycleRows.length > 0) {
    const sumDays = wonCycleRows.reduce((acc, row) => {
      if (!row.closedAt) return acc;
      const ms = row.closedAt.getTime() - row.createdAt.getTime();
      return acc + ms / (1000 * 60 * 60 * 24);
    }, 0);
    avgTimeToWinDays = round2(sumDays / wonCycleRows.length);
  }

  const summary: DashboardSummary = {
    totalValue: round2(toNumber(openAgg._sum.value)),
    openDeals: openAggCount(openAgg),
    winRate,
    avgTicket,
    newContacts,
    wonCount,
    lostCount,
    wonValue: round2(wonValue),
    lostValue: round2(lostValue),
    leadsWithoutOwner,
    avgTimeToWinDays,
    deltas: {
      winRate: pctDelta(winRate, prevWinRate),
      avgTicket: pctDelta(avgTicket, prevAvgTicket),
      wonCount: pctDelta(wonCount, prevWonCount),
      wonValue: pctDelta(wonValue, prevWonValue),
    },
  };

  // ── Funil histórico (entered/exited via DealEvent) ───────────────
  // Cruza os eventos do período apenas com os deals que casam com os
  // filtros estruturais (ponte por dealId), mantendo a consistência.
  const dealIds = dealIdRows.map((d) => d.id);
  const [enteredRows, exitedRows] =
    dealIds.length > 0
      ? await Promise.all([
          prisma.$queryRaw<{ stageId: string; c: bigint }[]>(Prisma.sql`
            SELECT stage_id AS "stageId", COUNT(*)::bigint AS c FROM (
              SELECT (e.meta->'to'->>'id') AS stage_id
              FROM deal_events e
              WHERE e."organizationId" = ${orgId} AND e.type = 'STAGE_CHANGED'
                AND e."createdAt" >= ${f.from} AND e."createdAt" <= ${f.to}
                AND e."dealId" IN (${Prisma.join(dealIds)})
              UNION ALL
              SELECT (e.meta->>'stageId') AS stage_id
              FROM deal_events e
              WHERE e."organizationId" = ${orgId} AND e.type = 'CREATED'
                AND e."createdAt" >= ${f.from} AND e."createdAt" <= ${f.to}
                AND e."dealId" IN (${Prisma.join(dealIds)})
            ) x
            WHERE stage_id IS NOT NULL
            GROUP BY stage_id
          `),
          prisma.$queryRaw<{ stageId: string; c: bigint }[]>(Prisma.sql`
            SELECT (e.meta->'from'->>'id') AS "stageId", COUNT(*)::bigint AS c
            FROM deal_events e
            WHERE e."organizationId" = ${orgId} AND e.type = 'STAGE_CHANGED'
              AND e."createdAt" >= ${f.from} AND e."createdAt" <= ${f.to}
              AND e."dealId" IN (${Prisma.join(dealIds)})
              AND (e.meta->'from'->>'id') IS NOT NULL
            GROUP BY 1
          `),
        ])
      : [[], []];

  // ── Funil por etapa ──────────────────────────────────────────────
  const openStageMap = new Map(openByStage.map((r) => [r.stageId, r]));
  const wonStageMap = new Map(
    wonByStage.map((r) => [r.stageId, Number(r._count._all)]),
  );
  const lostStageMap = new Map(
    lostByStage.map((r) => [r.stageId, Number(r._count._all)]),
  );
  const enteredMap = new Map(enteredRows.map((r) => [r.stageId, Number(r.c)]));
  const exitedMap = new Map(exitedRows.map((r) => [r.stageId, Number(r.c)]));
  const funnel: DashboardFunnelStage[] = stages.map((s) => {
    const open = openStageMap.get(s.id);
    const won = wonStageMap.get(s.id) ?? 0;
    const lost = lostStageMap.get(s.id) ?? 0;
    return {
      id: s.id,
      name: s.name,
      color: s.color,
      count: open ? Number(open._count._all) : 0,
      value: open ? toNumber(open._sum.value) : 0,
      won,
      lost,
      conversion: conversion(won, lost),
      entered: enteredMap.get(s.id) ?? 0,
      exited: exitedMap.get(s.id) ?? 0,
    };
  });

  // ── Ranking de consultores ───────────────────────────────────────
  const ownerIds = new Set<string>();
  for (const r of [...ownerOpen, ...ownerWon, ...ownerLost, ...ownerCreated]) {
    if (r.ownerId) ownerIds.add(r.ownerId);
  }
  const owners = ownerIds.size
    ? await prisma.user.findMany({
        where: { id: { in: [...ownerIds] } },
        select: { id: true, name: true },
      })
    : [];
  const ownerName = new Map(owners.map((u) => [u.id, u.name]));
  const openByOwner = new Map(
    ownerOpen.map((r) => [r.ownerId, Number(r._count._all)]),
  );
  const wonByOwner = new Map(
    ownerWon.map((r) => [
      r.ownerId,
      { c: Number(r._count._all), v: toNumber(r._sum.value) },
    ]),
  );
  const lostByOwner = new Map(
    ownerLost.map((r) => [r.ownerId, Number(r._count._all)]),
  );
  const createdByOwner = new Map(
    ownerCreated.map((r) => [r.ownerId, Number(r._count._all)]),
  );
  const byOwner: DashboardOwnerRow[] = [...ownerIds]
    .map((id) => {
      const won = wonByOwner.get(id)?.c ?? 0;
      const lost = lostByOwner.get(id) ?? 0;
      return {
        id,
        name: ownerName.get(id) ?? "Sem nome",
        leads: createdByOwner.get(id) ?? 0,
        open: openByOwner.get(id) ?? 0,
        won,
        lost,
        conversion: conversion(won, lost),
        wonValue: round2(wonByOwner.get(id)?.v ?? 0),
      };
    })
    .sort((a, b) => b.wonValue - a.wonValue || b.won - a.won || b.leads - a.leads);

  // ── Agregações em memória sobre `periodDeals` ────────────────────
  // Um único loop alimenta: origem, tags, motivos de perda e evolução
  // diária — evitando refazer fetch para cada bloco.
  type Bucket = { count: number; won: number; lost: number; wonValue: number };
  const newBucket = (): Bucket => ({ count: 0, won: 0, lost: 0, wonValue: 0 });
  const inPeriod = (d: Date | null): boolean => !!d && d >= f.from && d <= f.to;

  const sourceBuckets = new Map<string, Bucket>();
  const tagBuckets = new Map<string, Bucket & { name: string; color: string }>();
  const lossBuckets = new Map<string, { count: number; value: number }>();

  // Evolução diária: pré-popula todos os dias do período com zero.
  const dayKey = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const dailyMap = new Map<string, DashboardDailyPoint>();
  {
    const cursor = new Date(f.from);
    cursor.setHours(0, 0, 0, 0);
    const end = new Date(f.to);
    // Limite defensivo para ranges muito longos (ex.: anos).
    let guard = 0;
    while (cursor <= end && guard < 800) {
      const key = dayKey(cursor);
      dailyMap.set(key, { date: key, novos: 0, ganhos: 0, perdidos: 0 });
      cursor.setDate(cursor.getDate() + 1);
      guard++;
    }
  }

  for (const row of periodDeals) {
    const createdIn = inPeriod(row.createdAt);
    const wonIn = row.status === "WON" && inPeriod(row.closedAt);
    const lostIn = row.status === "LOST" && inPeriod(row.closedAt);
    const val = toNumber(row.value);

    // Origem
    const rawSource = row.contact?.source;
    const sourceKey = rawSource && rawSource.trim() ? rawSource : SOURCE_NONE;
    const sb = sourceBuckets.get(sourceKey) ?? newBucket();
    sourceBuckets.set(sourceKey, sb);

    // Tags (um deal pode ter várias)
    const tagAccum: (Bucket & { name: string; color: string })[] = [];
    for (const t of row.tags) {
      const tag = t.tag;
      let tb = tagBuckets.get(tag.id);
      if (!tb) {
        tb = { ...newBucket(), name: tag.name, color: tag.color };
        tagBuckets.set(tag.id, tb);
      }
      tagAccum.push(tb);
    }

    if (createdIn) {
      sb.count++;
      for (const tb of tagAccum) tb.count++;
      const d = dailyMap.get(dayKey(row.createdAt));
      if (d) d.novos++;
    }
    if (wonIn) {
      sb.won++;
      sb.wonValue += val;
      for (const tb of tagAccum) {
        tb.won++;
        tb.wonValue += val;
      }
      const d = dailyMap.get(dayKey(row.closedAt as Date));
      if (d) d.ganhos++;
    } else if (lostIn) {
      sb.lost++;
      for (const tb of tagAccum) tb.lost++;
      const d = dailyMap.get(dayKey(row.closedAt as Date));
      if (d) d.perdidos++;
      // Motivo de perda
      const reason = row.lostReason?.trim() ? row.lostReason.trim() : "Sem motivo";
      const lb = lossBuckets.get(reason) ?? { count: 0, value: 0 };
      lb.count++;
      lb.value += val;
      lossBuckets.set(reason, lb);
    }
  }

  const bySource: DashboardSourceRow[] = [...sourceBuckets.entries()]
    .map(([key, b]) => ({
      key,
      label: key === SOURCE_NONE ? "Sem origem" : key,
      count: b.count,
      won: b.won,
      lost: b.lost,
      conversion: conversion(b.won, b.lost),
      wonValue: round2(b.wonValue),
    }))
    .sort((a, b) => b.count - a.count || b.wonValue - a.wonValue);

  const byTag: DashboardTagRow[] = [...tagBuckets.entries()]
    .map(([id, b]) => ({
      id,
      name: b.name,
      color: b.color,
      count: b.count,
      won: b.won,
      lost: b.lost,
      conversion: conversion(b.won, b.lost),
      wonValue: round2(b.wonValue),
    }))
    .filter((t) => t.count > 0 || t.won > 0 || t.lost > 0)
    .sort((a, b) => b.count - a.count || b.wonValue - a.wonValue);

  const lossReasons: DashboardLossReason[] = [...lossBuckets.entries()]
    .map(([reason, b]) => ({ reason, count: b.count, value: round2(b.value) }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  const dailyEvolution: DashboardDailyPoint[] = [...dailyMap.values()].sort(
    (a, b) => a.date.localeCompare(b.date),
  );

  // ── Leads parados por etapa ──────────────────────────────────────
  // OPEN cujo updatedAt ultrapassou o rottingDays da etapa.
  const now = Date.now();
  const dayMs = 1000 * 60 * 60 * 24;
  const rottingByStage = new Map(stages.map((s) => [s.id, s.rottingDays]));
  const stalledBuckets = new Map<string, { count: number; value: number }>();
  for (const d of openStallRows) {
    const rotting = rottingByStage.get(d.stageId);
    if (rotting == null) continue;
    const ageDays = (now - d.updatedAt.getTime()) / dayMs;
    if (ageDays <= rotting) continue;
    const sb = stalledBuckets.get(d.stageId) ?? { count: 0, value: 0 };
    sb.count++;
    sb.value += toNumber(d.value);
    stalledBuckets.set(d.stageId, sb);
  }
  const stalled: DashboardStalledStage[] = stages
    .filter((s) => stalledBuckets.has(s.id))
    .map((s) => {
      const b = stalledBuckets.get(s.id)!;
      return {
        id: s.id,
        name: s.name,
        color: s.color,
        count: b.count,
        value: round2(b.value),
        rottingDays: s.rottingDays,
      };
    })
    .sort((a, b) => b.count - a.count);

  return {
    pipelineId: f.pipelineId,
    summary,
    funnel,
    bySource,
    byOwner,
    byTag,
    lossReasons,
    dailyEvolution,
    stalled,
  };
}

/**
 * `aggregate({ _count: true })` retorna `number`; isolamos o cast num
 * helper para manter o corpo legível.
 */
function openAggCount(agg: { _count: number | { _all?: number } }): number {
  if (typeof agg._count === "number") return agg._count;
  return Number(agg._count?._all ?? 0);
}
