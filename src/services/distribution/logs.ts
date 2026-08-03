/**
 * Histórico de distribuições (DistributionLog) para a aba "Logs" da tela de
 * Distribuição: quem recebeu, quando, resultado, origem e departamento.
 *
 * `DistributionLog` é org-scoped (a Prisma Extension injeta o filtro de org).
 * `User` NÃO é org-scoped → filtro manual. `Contact` é org-scoped.
 *
 * Paginação por cursor composto (`${createdAtMs}_${id}`), estável para
 * eventos no mesmo instante (createdAt desc, id desc).
 */

import { prisma } from "@/lib/prisma";
import { getOrgIdOrThrow } from "@/lib/request-context";

export interface DistributionLogView {
  id: string;
  createdAt: string;
  success: boolean;
  reason: string;
  triggerSource: string;
  selectedUserId: string | null;
  selectedUserName: string | null;
  contactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  conversationId: string | null;
  departmentId: string | null;
  departmentName: string | null;
}

export interface DepartmentDistributionStat {
  departmentId: string | null;
  departmentName: string;
  /** Logs com success=true (qualquer origem) ligados a esse dept. */
  distributed: number;
  /** Destes, quantos vieram do agente IA (trigger contém AI_AGENT). */
  distributedByAi: number;
  /** Conversas OPEN sem responsável nesse dept (fila de espera). */
  pending: number;
}

function parseCursor(raw: string | null): { createdAt: Date; id: string } | null {
  if (!raw) return null;
  const [tsStr, id] = raw.split("_");
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || !id) return null;
  return { createdAt: new Date(ts), id };
}

export async function getDistributionLogs(opts: {
  limit?: number;
  cursor?: string | null;
} = {}): Promise<{ items: DistributionLogView[]; nextCursor: string | null }> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 30));
  const cursor = parseCursor(opts.cursor ?? null);

  const rows = await prisma.distributionLog.findMany({
    where: cursor
      ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }
      : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      createdAt: true,
      success: true,
      reason: true,
      triggerSource: true,
      selectedUserId: true,
      contactId: true,
      conversationId: true,
    },
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  const orgId = getOrgIdOrThrow();
  const userIds = [
    ...new Set(items.map((r) => r.selectedUserId).filter(Boolean) as string[]),
  ];
  const contactIds = [
    ...new Set(items.map((r) => r.contactId).filter(Boolean) as string[]),
  ];
  const conversationIds = [
    ...new Set(
      items.map((r) => r.conversationId).filter(Boolean) as string[],
    ),
  ];

  const [users, contacts, conversations] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds }, organizationId: orgId },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    contactIds.length
      ? prisma.contact.findMany({
          where: { id: { in: contactIds } },
          select: { id: true, name: true, phone: true },
        })
      : Promise.resolve([]),
    conversationIds.length
      ? prisma.conversation.findMany({
          where: { id: { in: conversationIds } },
          select: {
            id: true,
            departmentId: true,
            department: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const userName = new Map(users.map((u) => [u.id, u.name]));
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const convById = new Map(conversations.map((c) => [c.id, c]));

  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? `${last.createdAt.getTime()}_${last.id}` : null;

  return {
    items: items.map((r) => {
      const contact = r.contactId ? contactById.get(r.contactId) : null;
      const conv = r.conversationId ? convById.get(r.conversationId) : null;
      return {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        success: r.success,
        reason: r.reason,
        triggerSource: r.triggerSource,
        selectedUserId: r.selectedUserId,
        selectedUserName: r.selectedUserId
          ? userName.get(r.selectedUserId) ?? null
          : null,
        contactId: r.contactId,
        contactName: contact?.name ?? null,
        contactPhone: contact?.phone ?? null,
        conversationId: r.conversationId,
        departmentId: conv?.departmentId ?? null,
        departmentName: conv?.department?.name ?? null,
      };
    }),
    nextCursor,
  };
}

/**
 * Contadores por departamento: quantos já foram distribuídos (logs sucesso)
 * e quantos ainda aguardam na fila (OPEN sem responsável).
 */
export async function getDistributionDepartmentStats(): Promise<{
  departments: DepartmentDistributionStat[];
}> {
  const orgId = getOrgIdOrThrow();

  const [pendingGroups, successLogs, departments] = await Promise.all([
    prisma.conversation.groupBy({
      by: ["departmentId"],
      where: {
        organizationId: orgId,
        status: "OPEN",
        assignedToId: null,
      },
      _count: { _all: true },
    }),
    prisma.distributionLog.findMany({
      where: { success: true },
      select: {
        triggerSource: true,
        conversationId: true,
      },
    }),
    prisma.department.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const convIds = [
    ...new Set(
      successLogs
        .map((l) => l.conversationId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const convDepts =
    convIds.length > 0
      ? await prisma.conversation.findMany({
          where: { id: { in: convIds } },
          select: { id: true, departmentId: true },
        })
      : [];
  const convDeptById = new Map(
    convDepts.map((c) => [c.id, c.departmentId ?? null]),
  );

  type Acc = {
    departmentId: string | null;
    distributed: number;
    distributedByAi: number;
    pending: number;
  };
  const byKey = new Map<string, Acc>();

  const ensure = (departmentId: string | null): Acc => {
    const key = departmentId ?? "__none__";
    let row = byKey.get(key);
    if (!row) {
      row = {
        departmentId,
        distributed: 0,
        distributedByAi: 0,
        pending: 0,
      };
      byKey.set(key, row);
    }
    return row;
  };

  for (const g of pendingGroups) {
    ensure(g.departmentId).pending = g._count._all;
  }

  for (const log of successLogs) {
    const deptId = log.conversationId
      ? (convDeptById.get(log.conversationId) ?? null)
      : null;
    const row = ensure(deptId);
    row.distributed += 1;
    if (log.triggerSource.includes("AI_AGENT")) {
      row.distributedByAi += 1;
    }
  }

  // Garante que depts cadastrados apareçam mesmo com zero.
  for (const d of departments) {
    ensure(d.id);
  }

  const departmentsOut: DepartmentDistributionStat[] = [...byKey.values()]
    .map((row) => ({
      departmentId: row.departmentId,
      departmentName: row.departmentId
        ? deptName.get(row.departmentId) ?? "Departamento"
        : "Sem departamento",
      distributed: row.distributed,
      distributedByAi: row.distributedByAi,
      pending: row.pending,
    }))
    .sort((a, b) => {
      const score = (x: DepartmentDistributionStat) =>
        x.pending + x.distributed;
      const diff = score(b) - score(a);
      if (diff !== 0) return diff;
      return a.departmentName.localeCompare(b.departmentName, "pt-BR");
    });

  return { departments: departmentsOut };
}
