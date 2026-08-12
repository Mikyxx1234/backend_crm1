/**
 * Flag `conversation.hasError` (fila Inbox → Erro).
 *
 * Regra de produto: se o cliente já respondeu depois (`lastMessageDirection =
 * "in"`), a falha de envio deixa de ser acionável — a conversa volta para
 * Entrada/Aguardando/Respondidas. Status `failed` tardio da Meta ou o
 * sweeper de outbound NÃO podem recolocar a conversa em Erro nesse caso
 * (race clássico: envio falha → cliente responde → webhook failed chega).
 */

import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type Db = Pick<PrismaClient, "conversation">;

/**
 * Marca a conversa com erro de envio, a menos que o último evento seja
 * inbound do cliente. Retorna `true` se marcou.
 */
export async function markConversationHasError(
  conversationId: string,
  db: Db = prisma,
): Promise<boolean> {
  const conv = await db.conversation
    .findUnique({
      where: { id: conversationId },
      select: { lastMessageDirection: true },
    })
    .catch(() => null);

  if (conv?.lastMessageDirection === "in") {
    return false;
  }

  await db.conversation
    .update({
      where: { id: conversationId },
      data: { hasError: true, updatedAt: new Date() },
    })
    .catch(() => {});
  return true;
}
