import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Stats do dia para o "painel do dia" no topo do Inbox.
 *
 * Retorna 3 métricas que importam para o consultor agora:
 *   - `pending`: conversas abertas que precisam da atenção dele (cliente
 *     mandou mensagem e ninguém respondeu ainda).
 *   - `messagesToday`: quantas mensagens ele já enviou hoje (sensação
 *     de progresso pessoal — "já bati 50 mensagens").
 *   - `slaCritical`: subset de `pending` com lastMessageAt > 1h (cliente
 *     esperando resposta há mais de 1h — alerta vermelho).
 *
 * É chamada com refetch a cada 30s; consulta leve (3 counts indexados).
 */
export async function GET() {
  const r = await requireAuth();
  if (!r.ok) return r.response;
  const userId = r.session.user.id;

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // Pendentes "do consultor" = atribuídas a ele (ou não atribuídas) que
  // estão OPEN, última mensagem foi do cliente e não há resposta.
  // Para ADMIN/MANAGER mostramos a fila inteira; para MEMBER, só as suas.
  const role = r.session.user.role;
  const isAgent = role === "MEMBER";

  const pendingWhere = {
    status: "OPEN" as const,
    lastMessageDirection: "in",
    hasAgentReply: false,
    ...(isAgent
      ? {
          OR: [{ assignedToId: userId }, { assignedToId: null }],
        }
      : {}),
  };

  const [pending, slaCritical, messagesToday] = await Promise.all([
    prisma.conversation.count({ where: pendingWhere }),
    prisma.conversation.count({
      where: {
        ...pendingWhere,
        // Conversas pendentes com última mensagem (do cliente) há > 1h.
        // updatedAt da conversa muda quando chega/sai mensagem, então é
        // proxy razoável pra "tempo desde última atividade".
        updatedAt: { lt: oneHourAgo },
      },
    }),
    prisma.message.count({
      where: {
        direction: "out",
        isPrivate: false,
        createdAt: { gte: startOfDay },
        // Filtramos pelo agente que mandou — usado p/ stats pessoal.
        // Conversation.assignedToId é proxy fraco; melhor seria
        // Message.userId, mas o schema atual não tem isso. Usamos
        // assignedToId da conversa pra aproximar.
        conversation: { assignedToId: userId },
      },
    }),
  ]);

  return NextResponse.json({
    pending,
    slaCritical,
    messagesToday,
  });
}
