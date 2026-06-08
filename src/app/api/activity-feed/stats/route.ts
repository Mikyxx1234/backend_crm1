import { NextResponse } from "next/server";

import { Prisma } from "@prisma/client";

import { requireManager } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getOrgIdOrThrow } from "@/lib/request-context";

/**
 * GET /api/activity-feed/stats
 *
 * Agregacoes sobre `activity_events` org-scoped. Suporta um window
 * (default 30 dias). Usa $queryRawUnsafe pra agregacoes Postgres que
 * o Prisma Client nao expoe nativamente (date_trunc).
 *
 * Query params:
 *   - dateFrom  ISO (default: now() - 30 dias)
 *   - dateTo    ISO (default: now())
 *
 * Resposta:
 *   {
 *     totals: { total, byActorType: {...}, byEntityType: {...}, byType: [{ type, count }] },
 *     timeline: [{ day: "2026-06-05", count }]
 *   }
 */
export async function GET(req: Request) {
  try {
    // Stats de logs: restrito a gestão (ADMIN/MANAGER). requireManager
    // também ativa o RequestContext usado por getOrgIdOrThrow() abaixo.
    const r = await requireManager();
    if (!r.ok) return r.response;

    const orgId = getOrgIdOrThrow();
    const url = new URL(req.url);
    const dateFromRaw = url.searchParams.get("dateFrom");
    const dateToRaw = url.searchParams.get("dateTo");
    const dateTo = dateToRaw ? new Date(dateToRaw) : new Date();
    const dateFrom = dateFromRaw
      ? new Date(dateFromRaw)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [byActor, byEntity, byType, timeline, totalRow] = await Promise.all([
      prisma.activityEvent.groupBy({
        by: ["actorType"],
        where: { organizationId: orgId, occurredAt: { gte: dateFrom, lte: dateTo } },
        _count: { _all: true },
      }),
      prisma.activityEvent.groupBy({
        by: ["entityType"],
        where: { organizationId: orgId, occurredAt: { gte: dateFrom, lte: dateTo } },
        _count: { _all: true },
      }),
      prisma.activityEvent.groupBy({
        by: ["type"],
        where: { organizationId: orgId, occurredAt: { gte: dateFrom, lte: dateTo } },
        _count: { _all: true },
        orderBy: { _count: { type: "desc" } },
        take: 20,
      }),
      prisma.$queryRaw<{ day: Date; count: bigint }[]>(Prisma.sql`
        SELECT date_trunc('day', "occurredAt") AS day, COUNT(*)::bigint AS count
        FROM "activity_events"
        WHERE "organizationId" = ${orgId}
          AND "occurredAt" >= ${dateFrom}
          AND "occurredAt" <= ${dateTo}
        GROUP BY 1
        ORDER BY 1 ASC
      `),
      prisma.activityEvent.count({
        where: { organizationId: orgId, occurredAt: { gte: dateFrom, lte: dateTo } },
      }),
    ]);

    return NextResponse.json({
      window: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
      totals: {
        total: totalRow,
        byActorType: Object.fromEntries(
          byActor.map((r) => [r.actorType, r._count._all]),
        ),
        byEntityType: Object.fromEntries(
          byEntity.map((r) => [r.entityType, r._count._all]),
        ),
        byType: byType.map((r) => ({ type: r.type, count: r._count._all })),
      },
      timeline: timeline.map((r) => ({
        day: r.day.toISOString().slice(0, 10),
        count: Number(r.count),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Erro." },
      { status: 500 },
    );
  }
}
