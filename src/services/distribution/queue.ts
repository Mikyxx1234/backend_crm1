/**
 * Fila atual de cada responsável = nº de `Deal` OPEN com `ownerId = usuário`
 * na organização atual. Uma única `groupBy` (sem N+1). `Deal` é org-scoped,
 * então o filtro de organização é injetado pela Prisma Extension.
 */

import { prisma } from "@/lib/prisma";

/**
 * Mapa userId → quantidade de deals OPEN. Usuários sem deals OPEN não
 * aparecem no mapa (o caller assume 0).
 */
export async function getQueueCounts(
  userIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (userIds.length === 0) return result;

  const rows = await prisma.deal.groupBy({
    by: ["ownerId"],
    where: { status: "OPEN", ownerId: { in: userIds } },
    _count: { _all: true },
  });

  for (const row of rows) {
    if (row.ownerId) result.set(row.ownerId, row._count._all);
  }
  return result;
}
