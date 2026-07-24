/**
 * Histórico de distribuições (DistributionLog) para a aba "Logs" da tela de
 * Distribuição: quem recebeu, quando, resultado e origem do gatilho.
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

  const [users, contacts] = await Promise.all([
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
  ]);

  const userName = new Map(users.map((u) => [u.id, u.name]));
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? `${last.createdAt.getTime()}_${last.id}` : null;

  return {
    items: items.map((r) => {
      const contact = r.contactId ? contactById.get(r.contactId) : null;
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
      };
    }),
    nextCursor,
  };
}
