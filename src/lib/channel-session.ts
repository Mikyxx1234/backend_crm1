import { prisma } from "@/lib/prisma";

export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ChannelSessionInfo = {
  active: boolean;
  lastInboundAt: Date | null;
  expiresAt: Date | null;
};

function sessionFromLastInbound(lastInboundAt: Date | null): ChannelSessionInfo {
  const diffMs = lastInboundAt ? Date.now() - lastInboundAt.getTime() : null;
  const active = diffMs !== null ? diffMs < SESSION_WINDOW_MS : false;
  const expiresAt = lastInboundAt
    ? new Date(lastInboundAt.getTime() + SESSION_WINDOW_MS)
    : null;
  return { active, lastInboundAt, expiresAt };
}

/**
 * Última inbound real do contato naquele Channel (número Meta).
 *
 * Não usa `conversations.lastInboundAt` — a coluna fica stale (replay,
 * troca de channelId no ticket, history=1) e o composer mostra 24h
 * fechada com bolha de hoje no chat.
 *
 * Janela da Meta é por (aluno, phone_number_id). `message.channelId`
 * prevalece; mensagens antigas sem snapshot caem no `channelId` atual
 * da conversa.
 */
async function lastInboundOnChannel(
  contactId: string,
  channelId: string,
): Promise<Date | null> {
  const lastInMsg = await prisma.message.findFirst({
    where: {
      direction: "in",
      AND: [
        { conversation: { contactId } },
        {
          OR: [
            { channelId },
            { AND: [{ channelId: null }, { conversation: { channelId } }] },
          ],
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return lastInMsg?.createdAt ?? null;
}

/**
 * Janela de 24h no canal da própria conversa. Sempre deriva das
 * mensagens inbound — nunca da coluna desnormalizada.
 */
export async function getConversationSession(conv: {
  id: string;
  contactId: string | null;
  channel: string;
  channelId?: string | null;
  lastInboundAt?: Date | null;
}): Promise<ChannelSessionInfo> {
  if (conv.contactId && conv.channelId) {
    return getContactChannelSession(conv.contactId, conv.channelId);
  }

  const lastInMsg = await prisma.message.findFirst({
    where: {
      direction: "in",
      conversation: conv.contactId
        ? { contactId: conv.contactId, channel: conv.channel }
        : { id: conv.id },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return sessionFromLastInbound(lastInMsg?.createdAt ?? null);
}

/**
 * Janela de 24h da Meta para o par (contato, canal = número).
 */
export async function getContactChannelSession(
  contactId: string,
  channelId: string,
): Promise<ChannelSessionInfo> {
  const lastInboundAt = await lastInboundOnChannel(contactId, channelId);
  return sessionFromLastInbound(lastInboundAt);
}
