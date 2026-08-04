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
  byTabulation: TabulationTopItem[];
  byUser: TabulationByUserItem[];
  items: TabulationAnalyticsRow[];
};

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

  const baseWhere: Prisma.ActivityEventWhereInput = {
    organizationId: orgId,
    type: "CONVERSATION_TABULATED",
    occurredAt: { gte: filters.from, lte: filters.to },
    ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
  };

  // Filtros em meta JSON — aplica em memória após fetch limitado, ou via
  // path do Prisma quando possível.
  const events = await prisma.activityEvent.findMany({
    where: baseWhere,
    orderBy: { occurredAt: "desc" },
    take: 5000,
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
  });

  let filtered = events;
  if (filters.departmentId) {
    filtered = filtered.filter(
      (e) => metaString(e.meta, "departmentId") === filters.departmentId,
    );
  }
  if (filters.tabulationId) {
    filtered = filtered.filter(
      (e) => metaString(e.meta, "tabulationId") === filters.tabulationId,
    );
  }

  const total = filtered.length;
  const tabCounts = new Map<string, number>();
  const userCounts = new Map<string, { name: string; count: number }>();

  for (const e of filtered) {
    const tabId = metaString(e.meta, "tabulationId");
    if (tabId) tabCounts.set(tabId, (tabCounts.get(tabId) ?? 0) + 1);
    if (e.actorUserId) {
      const prev = userCounts.get(e.actorUserId);
      userCounts.set(e.actorUserId, {
        name: e.actorUser?.name ?? "Usuário",
        count: (prev?.count ?? 0) + 1,
      });
    }
  }

  const allTabIds = [...new Set([...tabCounts.keys()])];
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

  const byTabulation: TabulationTopItem[] = [...tabCounts.entries()]
    .map(([tabulationId, count]) => {
      const info = pathMap.get(tabulationId);
      return {
        tabulationId,
        name: info?.name ?? tabulationId,
        path: info?.path ?? tabulationId,
        count,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const byUser: TabulationByUserItem[] = [...userCounts.entries()]
    .map(([userId, v]) => ({ userId, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const pageItems = filtered.slice((page - 1) * perPage, page * perPage);
  const pageTabIds = [
    ...new Set(
      pageItems
        .map((e) => metaString(e.meta, "tabulationId"))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  // pathMap já tem todos; ok.

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
    byTabulation,
    byUser,
    items,
  };
}
