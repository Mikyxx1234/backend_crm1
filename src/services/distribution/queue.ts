/**
 * Fila (carga) de cada responsável = nº de CONVERSAS OPEN atribuídas onde é a
 * VEZ DO AGENTE responder — "Entrada" + "Aguardando" no vocabulário do inbox.
 * Serve de base tanto para o LIMITE (`queueLimit` = teto de conversas abertas
 * simultâneas) quanto para a SELEÇÃO ("menor carga" em `engine.selectResponsible`).
 *
 * Critério (ver AGENT.md 2026-07-30):
 *   `status = OPEN` AND `assignedToId = user` AND `hasError = false`
 *   AND (`hasHumanReply = false` OR `lastMessageDirection = "in"`)
 *
 * Ou seja: só conta o que realmente depende do consultor agora.
 *   - "Entrada"    (`hasHumanReply=false`) → conta.
 *   - "Aguardando" (`hasHumanReply=true` + `lastMessageDirection="in"`) → conta.
 *   - "Respondidas" (`out`, esperando cliente) → NÃO conta (não é carga ativa,
 *     depende do cliente voltar; o ciclo é encerrado pela automação de
 *     inatividade em 30min).
 *   - "Erro" (`hasError=true`) → NÃO conta (precisa de correção, não é fila).
 *
 * Histórico (correção do caso "50 leads pra uma pessoa"): a versão anterior
 * contava TODAS as OPEN atribuídas, incluindo "Respondidas". O problema que
 * essa versão tentava evitar (consultor rápido zera fila e recebe leads sem
 * parar) é agora coberto pela cláusula `lastMessageDirection = "in"`: o
 * consultor só sai da fila quando **realmente** terminou o turno de fala
 * (respondeu por último). A pilha de "Respondidas" antigas depende da
 * automação "Aguardando Resposta" para encerrar/mover — sem ela, essas ficam
 * pra sempre, mas mesmo assim não travam a distribuição (que era o efeito
 * colateral da definição antiga).
 *
 * `Conversation` é org-scoped, então o filtro de organização é injetado pela
 * Prisma Extension. Uma única `groupBy` (sem N+1).
 */

import { prisma } from "@/lib/prisma";

/**
 * Mapa userId → nº de conversas OPEN aguardando ação do consultor.
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
      hasError: false,
      OR: [
        { hasHumanReply: false },
        { lastMessageDirection: "in" },
      ],
    },
    _count: { _all: true },
  });

  for (const row of rows) {
    if (row.assignedToId) result.set(row.assignedToId, row._count._all);
  }
  return result;
}
