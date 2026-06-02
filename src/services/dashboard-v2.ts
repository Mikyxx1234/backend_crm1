import { Prisma } from "@prisma/client";

import { analyticsClient } from "@/lib/analytics";
import { getOrgIdOrThrow } from "@/lib/request-context";
import {
  getDashboardMetrics,
  getInboxMetrics,
  type AnalyticsPeriod,
} from "@/services/analytics";

const prisma = analyticsClient();

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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Variação percentual entre dois valores; 0 quando base é 0. */
function pctDelta(current: number, previous: number): number {
  if (!previous) return 0;
  return round1(((current - previous) / previous) * 100);
}

/** Período imediatamente anterior, com a mesma duração. */
function previousPeriod(period: AnalyticsPeriod): AnalyticsPeriod {
  const span = period.to.getTime() - period.from.getTime();
  const to = new Date(period.from.getTime() - 1);
  const from = new Date(to.getTime() - span);
  return { from, to };
}

/** Segunda=0 … Domingo=6 (Postgres DOW: Dom=0). */
const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

const DONUT_COLORS = [
  "#5b6ff5",
  "#10D8D8",
  "#a78bfa",
  "#f59e0b",
  "#ef4444",
  "#10b981",
  "#ec4899",
  "#0ea5e9",
];

const PLATFORM_COLORS: Record<string, string> = {
  whatsapp: "#25D366",
  instagram: "#E1306C",
  facebook: "#1877F2",
  webchat: "#10D8D8",
  email: "#f59e0b",
};

function platformColor(key: string, index: number): string {
  return PLATFORM_COLORS[key.toLowerCase()] ?? DONUT_COLORS[index % DONUT_COLORS.length];
}

function formatMinutes(min: number): string {
  if (min <= 0) return "—";
  const totalSec = Math.round(min * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function formatHours(hours: number): string {
  if (hours <= 0) return "—";
  if (hours < 1) return formatMinutes(hours * 60);
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// ──────────────────────────────────────────────────────────────────
// DEALS (Negócios) — carrossel estilo Kommo
// ──────────────────────────────────────────────────────────────────

export interface DealStageFlow {
  id: string;
  name: string;
  color: string;
  count: number;
  value: number;
  entered: number;
  exited: number;
  lost: number;
  won: number;
}

export interface DealsOverviewResult {
  stages: DealStageFlow[];
  /** Negócios CRIADOS dentro do período selecionado (1º card do carrossel). */
  newInPeriod: { count: number; value: number };
  summary: {
    totalValue: number;
    totalDeals: number;
    winRate: number;
    avgTicket: number;
    deltas: { winRate: number; avgTicket: number };
  };
}

export async function getDealsOverview(
  period: AnalyticsPeriod,
  pipelineId: string,
  ownerId?: string,
): Promise<DealsOverviewResult> {
  const orgId = getOrgIdOrThrow();

  const stages = await prisma.stage.findMany({
    where: { pipelineId },
    orderBy: { position: "asc" },
    select: { id: true, name: true, color: true },
  });
  const stageIds = stages.map((s) => s.id);

  const ownerFilter = ownerId
    ? Prisma.sql`AND d."ownerId" = ${ownerId}`
    : Prisma.empty;

  // Snapshot atual: negócios OPEN por estágio (count + value).
  const snapshotRows = stageIds.length
    ? await prisma.$queryRaw<{ stageId: string; cnt: bigint; val: unknown }[]>(Prisma.sql`
        SELECT d."stageId" AS "stageId",
               COUNT(*)::bigint AS cnt,
               COALESCE(SUM(CAST(d.value AS DECIMAL)), 0) AS val
        FROM deals d
        WHERE d."organizationId" = ${orgId}
          AND d.status = 'OPEN'::"DealStatus"
          AND d."stageId" IN (${Prisma.join(stageIds)})
          ${ownerFilter}
        GROUP BY d."stageId"
      `)
    : [];

  // Entraram no período: STAGE_CHANGED.to + CREATED.stageId + IA moved_stage.
  const enteredRows = await prisma.$queryRaw<{ stageId: string; c: bigint }[]>(Prisma.sql`
    SELECT stage_id AS "stageId", COUNT(*)::bigint AS c FROM (
      SELECT (e.meta->'to'->>'id') AS stage_id
      FROM deal_events e
      WHERE e."organizationId" = ${orgId} AND e.type = 'STAGE_CHANGED'
        AND e."createdAt" >= ${period.from} AND e."createdAt" <= ${period.to}
      UNION ALL
      SELECT (e.meta->>'stageId') AS stage_id
      FROM deal_events e
      WHERE e."organizationId" = ${orgId} AND e.type = 'CREATED'
        AND e."createdAt" >= ${period.from} AND e."createdAt" <= ${period.to}
      UNION ALL
      SELECT (e.meta->>'stageId') AS stage_id
      FROM deal_events e
      WHERE e."organizationId" = ${orgId} AND e.type = 'AI_AGENT_ACTION'
        AND e.meta->>'action' = 'moved_stage'
        AND e."createdAt" >= ${period.from} AND e."createdAt" <= ${period.to}
    ) x
    WHERE stage_id IS NOT NULL
    GROUP BY stage_id
  `);

  // Saíram (avançaram): STAGE_CHANGED.from.
  const exitedRows = await prisma.$queryRaw<{ stageId: string; c: bigint }[]>(Prisma.sql`
    SELECT (e.meta->'from'->>'id') AS "stageId", COUNT(*)::bigint AS c
    FROM deal_events e
    WHERE e."organizationId" = ${orgId} AND e.type = 'STAGE_CHANGED'
      AND e."createdAt" >= ${period.from} AND e."createdAt" <= ${period.to}
      AND (e.meta->'from'->>'id') IS NOT NULL
    GROUP BY 1
  `);

  // Ganhos/Perdidos atribuídos ao estágio atual do deal.
  const statusRows = await prisma.$queryRaw<{ stageId: string; lost: bigint; won: bigint }[]>(Prisma.sql`
    SELECT d."stageId" AS "stageId",
           COUNT(*) FILTER (WHERE e.meta->>'to' = 'LOST')::bigint AS lost,
           COUNT(*) FILTER (WHERE e.meta->>'to' = 'WON')::bigint AS won
    FROM deal_events e
    INNER JOIN deals d ON d.id = e."dealId"
    WHERE e."organizationId" = ${orgId} AND e.type = 'STATUS_CHANGED'
      AND e."createdAt" >= ${period.from} AND e."createdAt" <= ${period.to}
      AND d."organizationId" = ${orgId}
    GROUP BY d."stageId"
  `);

  // Novos do período: negócios CRIADOS na janela (entrada de leads),
  // independente do status atual. Escopo = estágios do pipeline ativo.
  const newRows = stageIds.length
    ? await prisma.$queryRaw<{ cnt: bigint; val: unknown }[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS cnt,
               COALESCE(SUM(CAST(d.value AS DECIMAL)), 0) AS val
        FROM deals d
        WHERE d."organizationId" = ${orgId}
          AND d."stageId" IN (${Prisma.join(stageIds)})
          AND d."createdAt" >= ${period.from} AND d."createdAt" <= ${period.to}
          ${ownerFilter}
      `)
    : [];
  const newInPeriod = {
    count: newRows[0] ? Number(newRows[0].cnt) : 0,
    value: newRows[0] ? toNumber(newRows[0].val) : 0,
  };

  const snapMap = new Map(snapshotRows.map((r) => [r.stageId, r]));
  const enteredMap = new Map(enteredRows.map((r) => [r.stageId, Number(r.c)]));
  const exitedMap = new Map(exitedRows.map((r) => [r.stageId, Number(r.c)]));
  const statusMap = new Map(statusRows.map((r) => [r.stageId, r]));

  const stageFlow: DealStageFlow[] = stages.map((s) => {
    const snap = snapMap.get(s.id);
    const status = statusMap.get(s.id);
    return {
      id: s.id,
      name: s.name,
      color: s.color,
      count: snap ? Number(snap.cnt) : 0,
      value: snap ? toNumber(snap.val) : 0,
      entered: enteredMap.get(s.id) ?? 0,
      exited: exitedMap.get(s.id) ?? 0,
      lost: status ? Number(status.lost) : 0,
      won: status ? Number(status.won) : 0,
    };
  });

  const [cur, prev] = await Promise.all([
    getDashboardMetrics(period),
    getDashboardMetrics(previousPeriod(period)),
  ]);

  const totalValue = stageFlow.reduce((acc, s) => acc + s.value, 0);
  const totalDeals = stageFlow.reduce((acc, s) => acc + s.count, 0);

  return {
    stages: stageFlow,
    newInPeriod,
    summary: {
      totalValue: totalValue || cur.pipelineValue,
      totalDeals: totalDeals || cur.openDeals,
      winRate: cur.conversionRate,
      avgTicket: cur.avgDealSize,
      deltas: {
        winRate: pctDelta(cur.conversionRate, prev.conversionRate),
        avgTicket: pctDelta(cur.avgDealSize, prev.avgDealSize),
      },
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// SERVICE (Atendimento) — estilo Datacrazy
// ──────────────────────────────────────────────────────────────────

export interface DonutDatum {
  name: string;
  value: number;
  color: string;
}

export interface ServiceOverviewResult {
  summary: {
    total: { value: string; delta: number };
    firstResponse: { value: string; delta: number };
    resolutionTime: { value: string; delta: number };
    resolutionRate: { value: string; delta: number };
  };
  volumeByDay: { day: string; recebidas: number; enviadas: number }[];
  responseTimeSeries: { hour: string; resposta: number; primeira: number }[];
  byConnection: DonutDatum[];
  byAttendant: DonutDatum[];
  byPlatform: {
    rows: Record<string, number | string>[];
    platforms: { key: string; label: string; color: string }[];
  };
  heatmap: {
    cells: { x: number; y: number; value: number }[];
    xLabels: string[];
    yLabels: string[];
  };
  attendantRanking: {
    id: string;
    name: string;
    attended: number;
    avgResponse: string;
    resolution: number;
  }[];
}

export async function getServiceOverview(
  period: AnalyticsPeriod,
): Promise<ServiceOverviewResult> {
  const orgId = getOrgIdOrThrow();
  const { from, to } = period;

  const [cur, prev] = await Promise.all([
    getInboxMetrics(period),
    getInboxMetrics(previousPeriod(period)),
  ]);

  const curResolution =
    cur.totalConversations > 0
      ? round1((cur.resolvedConversations / cur.totalConversations) * 100)
      : 0;
  const prevResolution =
    prev.totalConversations > 0
      ? round1((prev.resolvedConversations / prev.totalConversations) * 100)
      : 0;

  // volumeByDay agregado por dia da semana (Seg..Dom).
  const volumeByDay = WEEKDAY_LABELS.map((day) => ({ day, recebidas: 0, enviadas: 0 }));
  for (const d of cur.byDay) {
    const date = new Date(`${d.date}T00:00:00Z`);
    const idx = (date.getUTCDay() + 6) % 7;
    volumeByDay[idx].recebidas += d.inbound;
    volumeByDay[idx].enviadas += d.outbound;
  }

  // responseTimeSeries: tempo médio por hora do dia.
  const respByHour = await prisma.$queryRaw<{ h: number; primeira: unknown; resposta: unknown }[]>(Prisma.sql`
    WITH pairs AS (
      SELECT
        m_in.id AS in_id,
        m_in."conversationId" AS conv,
        EXTRACT(HOUR FROM m_in."createdAt")::int AS h,
        EXTRACT(EPOCH FROM (
          (SELECT MIN(m_out."createdAt")
           FROM messages m_out
           WHERE m_out."conversationId" = m_in."conversationId"
             AND m_out.direction = 'out'
             AND m_out."createdAt" > m_in."createdAt"
             AND m_out."organizationId" = ${orgId})
          - m_in."createdAt"
        )) / 60.0 AS resp_min
      FROM messages m_in
      WHERE m_in.direction = 'in'
        AND m_in."createdAt" >= ${from} AND m_in."createdAt" <= ${to}
        AND m_in."organizationId" = ${orgId}
    ),
    first_per_conv AS (
      SELECT DISTINCT ON (conv) conv, h, resp_min
      FROM pairs
      WHERE resp_min IS NOT NULL
      ORDER BY conv, in_id
    )
    SELECT p.h AS h,
           AVG(fpc.resp_min) AS primeira,
           AVG(p.resp_min) AS resposta
    FROM pairs p
    LEFT JOIN first_per_conv fpc ON fpc.conv = p.conv AND fpc.h = p.h
    WHERE p.resp_min IS NOT NULL
    GROUP BY p.h
    ORDER BY p.h ASC
  `);
  const responseTimeSeries = respByHour
    .filter((r) => Number(r.h) >= 6 && Number(r.h) <= 22)
    .map((r) => ({
      hour: `${String(Number(r.h)).padStart(2, "0")}h`,
      resposta: round1(toNumber(r.resposta)),
      primeira: round1(toNumber(r.primeira)),
    }));

  // byConnection: agrupado pelo nome do canal/conexão.
  const connRows = await prisma.$queryRaw<{ name: string | null; c: bigint }[]>(Prisma.sql`
    SELECT ch.name AS name, COUNT(*)::bigint AS c
    FROM conversations conv
    LEFT JOIN channels ch ON ch.id = conv."channelId"
    WHERE conv."organizationId" = ${orgId}
      AND conv."createdAt" >= ${from} AND conv."createdAt" <= ${to}
    GROUP BY ch.name
    ORDER BY c DESC
  `);
  const byConnection: DonutDatum[] = connRows.slice(0, 8).map((r, i) => ({
    name: r.name ?? "Sem conexão",
    value: Number(r.c),
    color: DONUT_COLORS[i % DONUT_COLORS.length],
  }));

  // byAttendant: top 4 + Outros.
  const sortedAgents = [...cur.byAgent].sort((a, b) => b.conversations - a.conversations);
  const topAgents = sortedAgents.slice(0, 4);
  const restAgents = sortedAgents.slice(4);
  const byAttendant: DonutDatum[] = topAgents.map((a, i) => ({
    name: a.userName,
    value: a.conversations,
    color: DONUT_COLORS[i % DONUT_COLORS.length],
  }));
  if (restAgents.length) {
    byAttendant.push({
      name: "Outros",
      value: restAgents.reduce((s, a) => s + a.conversations, 0),
      color: "#cbd5e1",
    });
  }

  // byPlatform: volume por dia da semana por canal (string `channel`).
  const platformRows = await prisma.$queryRaw<{ dow: number; channel: string; c: bigint }[]>(Prisma.sql`
    SELECT ((EXTRACT(DOW FROM conv."createdAt")::int + 6) % 7) AS dow,
           LOWER(conv.channel) AS channel,
           COUNT(*)::bigint AS c
    FROM conversations conv
    WHERE conv."organizationId" = ${orgId}
      AND conv."createdAt" >= ${from} AND conv."createdAt" <= ${to}
    GROUP BY 1, 2
  `);
  const platformKeys = Array.from(new Set(platformRows.map((r) => r.channel))).slice(0, 6);
  const platformRowsByDay = WEEKDAY_LABELS.map((day) => {
    const row: Record<string, number | string> = { day };
    for (const k of platformKeys) row[k] = 0;
    return row;
  });
  for (const r of platformRows) {
    if (!platformKeys.includes(r.channel)) continue;
    const row = platformRowsByDay[Number(r.dow)];
    if (row) row[r.channel] = Number(r.c);
  }
  const platforms = platformKeys.map((key, i) => ({
    key,
    label: key.charAt(0).toUpperCase() + key.slice(1),
    color: platformColor(key, i),
  }));

  // heatmap: dia da semana × hora (mensagens recebidas).
  const heatRows = await prisma.$queryRaw<{ dow: number; h: number; c: bigint }[]>(Prisma.sql`
    SELECT ((EXTRACT(DOW FROM m."createdAt")::int + 6) % 7) AS dow,
           EXTRACT(HOUR FROM m."createdAt")::int AS h,
           COUNT(*)::bigint AS c
    FROM messages m
    WHERE m.direction = 'in'
      AND m."organizationId" = ${orgId}
      AND m."createdAt" >= ${from} AND m."createdAt" <= ${to}
    GROUP BY 1, 2
  `);
  const heatCells = heatRows.map((r) => ({
    x: Number(r.h),
    y: Number(r.dow),
    value: Number(r.c),
  }));
  const heatXLabels = Array.from({ length: 24 }, (_, i) => `${i}h`);

  // attendantRanking: conversas + tempo médio + taxa de resolução.
  const resolutionRows = await prisma.$queryRaw<{ assignedToId: string; total: bigint; resolved: bigint }[]>(Prisma.sql`
    SELECT conv."assignedToId" AS "assignedToId",
           COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE conv.status = 'RESOLVED'::"ConversationStatus")::bigint AS resolved
    FROM conversations conv
    WHERE conv."organizationId" = ${orgId}
      AND conv."assignedToId" IS NOT NULL
      AND conv."createdAt" >= ${from} AND conv."createdAt" <= ${to}
    GROUP BY conv."assignedToId"
  `);
  const resolutionMap = new Map(
    resolutionRows.map((r) => [
      r.assignedToId,
      Number(r.total) > 0 ? round1((Number(r.resolved) / Number(r.total)) * 100) : 0,
    ]),
  );
  const attendantRanking = sortedAgents.slice(0, 10).map((a) => ({
    id: a.userId,
    name: a.userName,
    attended: a.conversations,
    avgResponse: formatMinutes(a.avgResponseMinutes),
    resolution: resolutionMap.get(a.userId) ?? 0,
  }));

  return {
    summary: {
      total: {
        value: cur.totalConversations.toLocaleString("pt-BR"),
        delta: pctDelta(cur.totalConversations, prev.totalConversations),
      },
      firstResponse: {
        value: formatMinutes(cur.avgFirstResponseMinutes),
        delta: pctDelta(cur.avgFirstResponseMinutes, prev.avgFirstResponseMinutes),
      },
      resolutionTime: {
        value: formatHours(cur.avgResolutionHours),
        delta: pctDelta(cur.avgResolutionHours, prev.avgResolutionHours),
      },
      resolutionRate: {
        value: `${curResolution.toLocaleString("pt-BR")}%`,
        delta: round1(curResolution - prevResolution),
      },
    },
    volumeByDay,
    responseTimeSeries,
    byConnection,
    byAttendant,
    byPlatform: { rows: platformRowsByDay, platforms },
    heatmap: { cells: heatCells, xLabels: heatXLabels, yLabels: WEEKDAY_LABELS },
    attendantRanking,
  };
}
