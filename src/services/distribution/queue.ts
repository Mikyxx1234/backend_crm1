/**
 * Fila atual de cada responsável = nº de CONVERSAS aguardando a resposta DELE,
 * i.e. a "fila de não iniciados" (padrão DataCrazy): conversas OPEN atribuídas
 * ao consultor em que o cliente falou por último e ninguém respondeu ainda
 * (`lastMessageDirection = "in"` + `hasAgentReply = false`). É o MESMO recorte
 * da aba "Entrada" do inbox e do `pending` das stats do dia.
 *
 * NÃO contamos negócios/conversas "em aberto" parados aguardando o ALUNO
 * responder (esses ficam com `lastMessageDirection = "out"`), porque não são
 * trabalho pendente do consultor e inflariam a fila indevidamente.
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
      hasAgentReply: false,
    },
    _count: { _all: true },
  });

  for (const row of rows) {
    if (row.assignedToId) result.set(row.assignedToId, row._count._all);
  }
  return result;
}
