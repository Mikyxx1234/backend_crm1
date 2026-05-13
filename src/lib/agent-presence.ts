import type { AgentOnlineStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Registra uma transição de presença no histórico `agent_presence_logs`.
 *
 * Regra:
 *   1. Fecha qualquer bloco em aberto do agente (`endedAt IS NULL`) com `endedAt = now()`.
 *   2. Abre um novo bloco com o `status` alvo, `startedAt = now()`.
 *
 * Se `nextStatus` for igual ao status do bloco atualmente em aberto, **não** cria um
 * novo bloco (mantém o mesmo). Isso garante que pings/heartbeats consecutivos em
 * ONLINE não inflacionem o histórico.
 *
 * Idempotente: chamar duas vezes seguidas com o mesmo `nextStatus` não duplica linhas.
 */
export async function recordPresenceTransition(params: {
  userId: string;
  nextStatus: AgentOnlineStatus;
  at?: Date;
}): Promise<void> {
  const { userId, nextStatus } = params;
  const at = params.at ?? new Date();

  try {
    const open = await prisma.agentPresenceLog.findFirst({
      where: { userId, endedAt: null },
      orderBy: { startedAt: "desc" },
    });

    if (open && open.status === nextStatus) {
      return;
    }

    await prisma.$transaction(async (tx) => {
      if (open) {
        await tx.agentPresenceLog.update({
          where: { id: open.id },
          data: { endedAt: at },
        });
      }
      await tx.agentPresenceLog.create({
        data: { userId, status: nextStatus, startedAt: at },
      });
    });
  } catch (err) {
    // Migration ainda não aplicada em produção: registrar warning e seguir.
    // Não queremos que falha aqui bloqueie ping/status PUT.
    console.warn(
      "[recordPresenceTransition] falhou (provável migration pendente):",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Soma a duração (em milissegundos) em que cada agente esteve em cada status
 * dentro do intervalo `[from, to]`. Blocos abertos (endedAt NULL) são considerados
 * com fim em `min(to, now())`.
 *
 * Retorno: Map<userId, { online: number; away: number; offline: number }>.
 */
export async function computeActiveTimeByUser(params: {
  from: Date;
  to: Date;
  userIds?: string[];
}): Promise<Map<string, { online: number; away: number; offline: number }>> {
  const { from, to, userIds } = params;
  const now = new Date();
  const effectiveTo = to > now ? now : to;

  const result = new Map<
    string,
    { online: number; away: number; offline: number }
  >();

  try {
    const logs = await prisma.agentPresenceLog.findMany({
      where: {
        ...(userIds && userIds.length > 0 ? { userId: { in: userIds } } : {}),
        OR: [{ endedAt: null }, { endedAt: { gte: from } }],
        startedAt: { lte: effectiveTo },
      },
      select: { userId: true, status: true, startedAt: true, endedAt: true },
    });

    for (const log of logs) {
      const start = log.startedAt > from ? log.startedAt : from;
      const end = log.endedAt && log.endedAt < effectiveTo ? log.endedAt : effectiveTo;
      const ms = Math.max(0, end.getTime() - start.getTime());
      if (ms === 0) continue;

      const agg = result.get(log.userId) ?? { online: 0, away: 0, offline: 0 };
      if (log.status === "ONLINE") agg.online += ms;
      else if (log.status === "AWAY") agg.away += ms;
      else agg.offline += ms;
      result.set(log.userId, agg);
    }
  } catch (err) {
    console.warn(
      "[computeActiveTimeByUser] falhou (provável migration pendente):",
      err instanceof Error ? err.message : err,
    );
  }

  return result;
}
