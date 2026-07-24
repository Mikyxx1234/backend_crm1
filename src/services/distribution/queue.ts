/**
 * Fila atual de cada responsável = nº de CONVERSAS aguardando a resposta DELE:
 * conversas OPEN ATRIBUÍDAS ao consultor em que o cliente falou por último
 * (`lastMessageDirection = "in"`). É o MESMO recorte da aba "Aguardando" do
 * inbox — o que mantém a "Fila" da Distribuição consistente com o que o
 * operador vê no inbox.
 *
 * NÃO usamos mais `hasAgentReply = false`: esse campo é marcado também por
 * AUTOMAÇÃO/IA, então uma conversa distribuída em que o bot respondeu deixava
 * de contar na fila do humano (contagem de distribuídos errada). O que importa
 * para "fila do consultor" é: está atribuída a ele E é a vez dele responder.
 *
 * NÃO contamos conversas paradas aguardando o CLIENTE responder (essas ficam
 * com `lastMessageDirection = "out"`) — não são trabalho pendente do consultor.
 *
 * `Conversation` é org-scoped, então o filtro de organização é injetado pela
 * Prisma Extension. Uma única `groupBy` (sem N+1).
 */

import { prisma } from "@/lib/prisma";

/**
 * Mapa userId → quantidade de conversas aguardando resposta do consultor.
 * Usuários sem fila não aparecem no mapa (o caller assume 0).
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
      lastMessageDirection: "in",
    },
    _count: { _all: true },
  });

  for (const row of rows) {
    if (row.assignedToId) result.set(row.assignedToId, row._count._all);
  }
  return result;
}
