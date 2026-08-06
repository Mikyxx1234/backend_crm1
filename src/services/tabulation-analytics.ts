import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getOrgIdOrThrow } from "@/lib/request-context";

export type TabulationAnalyticsFilters = {
  from: Date;
  to: Date;
  actorUserId?: string | null;
  departmentId?: string | null;
  tabulationId?: string | null;
  page?: number;
  perPage?: number;
};

export type TabulationAnalyticsRow = {
  id: string;
  occurredAt: string;
  conversationId: string | null;
  contactId: string | null;
  contactName: string | null;
  actorUserId: string | null;
  actorName: string | null;
  tabulationId: string | null;
  tabulationName: string | null;
  tabulationPath: string | null;
  departmentId: string | null;
  departmentName: string | null;
};

export type TabulationTopItem = {
  tabulationId: string;
  name: string;
  path: string;
  count: number;
};

export type TabulationByUserItem = {
  userId: string;
  name: string;
  count: number;
};

export type TabulationAnalyticsResult = {
  total: number;
  page: number;
  perPage: number;
  /**
   * Cardinalidade real no período. `byTabulation`/`byUser` são rankings
   * truncados no top 20 — usar `.length` deles como KPI trava o número em 20.
   */
  distinctTabulations: number;
  distinctUsers: number;
  byTabulation: TabulationTopItem[];
  byUser: TabulationByUserItem[];
  items: TabulationAnalyticsRow[];
};

const TOP_LIMIT = 20;

function metaString(
  meta: Prisma.JsonValue | null | undefined,
  key: string,
): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const v = (meta as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

async function buildPathMap(
  tabulationIds: string[],
): Promise<Map<string, { name: string; path: string; departmentId: string | null }>> {
  const map = new Map<
    string,
    { name: string; path: string; departmentId: string | null }
  >();
  if (tabulationIds.length === 0) return map;

  const orgId = getOrgIdOrThrow();
  const rows = await prisma.tabulation.findMany({
    where: { organizationId: orgId, id: { in: tabulationIds } },
    select: {
      id: true,
      name: true,
      parentId: true,
      departmentId: true,
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Sobe a árvore para montar o path (pode precisar de pais fora do set).
  const missingParents = new Set<string>();
  for (const r of rows) {
    let p = r.parentId;
    while (p && !byId.has(p)) {
      missingParents.add(p);
      break;
    }
  }
  if (missingParents.size > 0) {
    const parents = await prisma.tabulation.findMany({
      where: { organizationId: orgId, id: { in: [...missingParents] } },
      select: { id: true, name: true, parentId: true, departmentId: true },
    });
    for (const p of parents) byId.set(p.id, p);
    // Uma passagem a mais costuma bastar; completa cadeia se necessário.
    let guard = 0;
    while (guard++ < 8) {
      const more = new Set<string>();
      for (const r of byId.values()) {
        if (r.parentId && !byId.has(r.parentId)) more.add(r.parentId);
      }
      if (more.size === 0) break;
      const extra = await prisma.tabulation.findMany({
        where: { organizationId: orgId, id: { in: [...more] } },
        select: { id: true, name: true, parentId: true, departmentId: true },
      });
      if (extra.length === 0) break;
      for (const e of extra) byId.set(e.id, e);
    }
  }

  for (const id of tabulationIds) {
    const names: string[] = [];
    let cursor: string | null = id;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const node = byId.get(cursor);
      if (!node) break;
      names.unshift(node.name);
      cursor = node.parentId;
    }
    const leaf = byId.get(id);
    map.set(id, {
      name: leaf?.name ?? id,
      path: names.join(" › ") || id,
      departmentId: leaf?.departmentId ?? null,
    });
  }
  return map;
}

export async function getTabulationAnalytics(
  filters: TabulationAnalyticsFilters,
): Promise<TabulationAnalyticsResult> {
  const orgId = getOrgIdOrThrow();
  const page = Math.max(1, filters.page ?? 1);
  const perPage = Math.min(100, Math.max(1, filters.perPage ?? 25));

  // Agregação no Postgres. A versão anterior puxava até 5000 eventos e
  // contava em memória: acima disso o "total" simplesmente parava de crescer,
  // sem aviso, e os filtros de meta rodavam DEPOIS do corte.
  const conds: Prisma.Sql[] = [
    Prisma.sql`"organizationId" = ${orgId}`,
    Prisma.sql`"type" = 'CONVERSATION_TABULATED'`,
    Prisma.sql`"occurredAt" >= ${filters.from}`,
    Prisma.sql`"occurredAt" <= ${filters.to}`,
  ];
  if (filters.actorUserId) {
    conds.push(Prisma.sql`"actorUserId" = ${filters.actorUserId}`);
  }
  if (filters.departmentId) {
    conds.push(Prisma.sql`meta->>'departmentId' = ${filters.departmentId}`);
  }
  if (filters.tabulationId) {
    conds.push(Prisma.sql`meta->>'tabulationId' = ${filters.tabulationId}`);
  }
  const whereSql = Prisma.join(conds, " AND ");

  const metaAnd: Prisma.ActivityEventWhereInput[] = [];
  if (filters.departmentId) {
    metaAnd.push({
      meta: { path: ["departmentId"], equals: filters.departmentId },
    });
  }
  if (filters.tabulationId) {
    metaAnd.push({
      meta: { path: ["tabulationId"], equals: filters.tabulationId },
    });
  }

  const [totals, tabRows, userRows, pageItems] = await Promise.all([
    prisma.$queryRaw<
      { total: bigint; distinct_tabulations: bigint; distinct_users: bigint }[]
    >(Prisma.sql`
      SELECT COUNT(*)::bigint AS total,
             COUNT(DISTINCT meta->>'tabulationId')::bigint AS distinct_tabulations,
             COUNT(DISTINCT "actorUserId")::bigint AS distinct_users
      FROM "activity_events"
      WHERE ${whereSql}
    `),
    prisma.$queryRaw<{ id: string; count: bigint }[]>(Prisma.sql`
      SELECT meta->>'tabulationId' AS id, COUNT(*)::bigint AS count
      FROM "activity_events"
      WHERE ${whereSql} AND meta->>'tabulationId' IS NOT NULL
      GROUP BY 1
      ORDER BY count DESC
      LIMIT ${TOP_LIMIT}
    `),
    prisma.$queryRaw<{ id: string; count: bigint }[]>(Prisma.sql`
      SELECT "actorUserId" AS id, COUNT(*)::bigint AS count
      FROM "activity_events"
      WHERE ${whereSql} AND "actorUserId" IS NOT NULL
      GROUP BY 1
      ORDER BY count DESC
      LIMIT ${TOP_LIMIT}
    `),
    prisma.activityEvent.findMany({
      where: {
        organizationId: orgId,
        type: "CONVERSATION_TABULATED",
        occurredAt: { gte: filters.from, lte: filters.to },
        ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
        ...(metaAnd.length > 0 ? { AND: metaAnd } : {}),
      },
      orderBy: { occurredAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        occurredAt: true,
        conversationId: true,
        contactId: true,
        actorUserId: true,
        meta: true,
        actorUser: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true } },
      },
    }),
  ]);

  const total = Number(totals[0]?.total ?? 0);
  const distinctTabulations = Number(totals[0]?.distinct_tabulations ?? 0);
  const distinctUsers = Number(totals[0]?.distinct_users ?? 0);

  const userNames = new Map<string, string>();
  if (userRows.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: userRows.map((r) => r.id) } },
      select: { id: true, name: true },
    });
    for (const u of users) userNames.set(u.id, u.name ?? "Usuário");
  }

  // O ranking é top 20, mas a página do log pode citar tabulações fora dele —
  // o pathMap precisa cobrir os dois conjuntos.
  const allTabIds = [
    ...new Set([
      ...tabRows.map((r) => r.id),
      ...pageItems
        .map((e) => metaString(e.meta, "tabulationId"))
        .filter((id): id is string => Boolean(id)),
    ]),
  ];
  const pathMap = await buildPathMap(allTabIds);

  const deptIds = [
    ...new Set(
      [...pathMap.values()]
        .map((v) => v.departmentId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const depts =
    deptIds.length > 0
      ? await prisma.department.findMany({
          where: { organizationId: orgId, id: { in: deptIds } },
          select: { id: true, name: true },
        })
      : [];
  const deptNameById = new Map(depts.map((d) => [d.id, d.name]));

  const byTabulation: TabulationTopItem[] = tabRows.map((r) => {
    const info = pathMap.get(r.id);
    return {
      tabulationId: r.id,
      name: info?.name ?? r.id,
      path: info?.path ?? r.id,
      count: Number(r.count),
    };
  });

  const byUser: TabulationByUserItem[] = userRows.map((r) => ({
    userId: r.id,
    name: userNames.get(r.id) ?? "Usuário",
    count: Number(r.count),
  }));

  const items: TabulationAnalyticsRow[] = pageItems.map((e) => {
    const tabulationId = metaString(e.meta, "tabulationId");
    const departmentId =
      metaString(e.meta, "departmentId") ??
      (tabulationId ? pathMap.get(tabulationId)?.departmentId ?? null : null);
    const info = tabulationId ? pathMap.get(tabulationId) : null;
    return {
      id: e.id,
      occurredAt: e.occurredAt.toISOString(),
      conversationId: e.conversationId,
      contactId: e.contactId,
      contactName: e.contact?.name ?? null,
      actorUserId: e.actorUserId,
      actorName: e.actorUser?.name ?? null,
      tabulationId,
      tabulationName: info?.name ?? null,
      tabulationPath: info?.path ?? null,
      departmentId,
      departmentName: departmentId
        ? (deptNameById.get(departmentId) ?? null)
        : null,
    };
  });

  return {
    total,
    page,
    perPage,
    distinctTabulations,
    distinctUsers,
    byTabulation,
    byUser,
    items,
  };
}
