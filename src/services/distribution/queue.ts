/**
 * Fila atual de cada responsável = nº de CONVERSAS que ainda são trabalho
 * pendente DELE: conversas OPEN ATRIBUÍDAS ao consultor em que é a vez do
 * consultor responder — ou o cliente falou por último (`lastMessageDirection =
 * "in"`), OU nenhum humano respondeu ainda (`hasHumanReply = false`, caso das
 * auto-distribuídas em que só a automação/IA mandou o aviso). No inbox isso
 * corresponde às abas "Entrada" (sem resposta humana) + "Aguardando" (humano
 * atendeu e o cliente falou por último) das conversas atribuídas a ele.
 *
 * NÃO usamos `hasAgentReply`: esse campo é marcado também por AUTOMAÇÃO/IA.
 * Usamos `hasHumanReply` (marcado só por envio humano) para saber se é a vez
 * do consultor.
 *
 * NÃO contamos conversas em que o humano já respondeu e aguardam o CLIENTE
 * (aba "Respondidas": `lastMessageDirection = "out"` + `hasHumanReply = true`).
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
      OR: [{ lastMessageDirection: "in" }, { hasHumanReply: false }],
    },
    _count: { _all: true },
  });

  for (const row of rows) {
    if (row.assignedToId) result.set(row.assignedToId, row._count._all);
  }
  return result;
}
