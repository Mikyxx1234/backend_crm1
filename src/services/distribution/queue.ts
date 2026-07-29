/**
 * Fila (carga) de cada responsável = nº TOTAL de CONVERSAS OPEN atribuídas a
 * ele, tenha ele respondido ou não. É a carga real do consultor e serve de base
 * tanto para o LIMITE (`queueLimit` = teto de conversas abertas simultâneas)
 * quanto para a SELEÇÃO ("menor carga" no `engine.selectResponsible`).
 *
 * IMPORTANTE (correção do caso "50 leads pra uma pessoa"): antes contávamos só
 * as conversas AGUARDANDO resposta do consultor (`lastMessageDirection = "in"`
 * OU `hasHumanReply = false`). Um consultor que respondia rápido zerava esse
 * pendente e continuava sendo "a menor fila" — recebendo leads sem parar e
 * furando o limite, que também olhava só o pendente. Passamos a contar TODA
 * conversa OPEN atribuída, para que o limite e o balanceamento reflitam a carga
 * total. A regra de "pendente" segue existindo para o inbox/redistribuição.
 *
 * `Conversation` é org-scoped, então o filtro de organização é injetado pela
 * Prisma Extension. Uma única `groupBy` (sem N+1).
 */

import { prisma } from "@/lib/prisma";

/**
 * Mapa userId → total de conversas OPEN atribuídas ao consultor.
 * Usuários sem conversas não aparecem no mapa (o caller assume 0).
 */
export async function getQueueCounts(
  userIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (userIds.length === 0) return result;

  const rows = await prisma.conversation.groupBy({
    by: ["assignedToId"],
    where: {
      status: "OPEN",
      assignedToId: { in: userIds },
    },
    _count: { _all: true },
  });

  for (const row of rows) {
    if (row.assignedToId) result.set(row.assignedToId, row._count._all);
  }
  return result;
}
