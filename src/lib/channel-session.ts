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
 * Janela de 24h da PRÓPRIA conversa — mesmo critério do GET messages:
 * `conv.lastInboundAt`, com fallback para a última message direction='in'
 * das conversas do contato no mesmo `channel` (ou só desta conversa quando
 * não há contato). Sem inbound → active: false.
 */
export async function getConversationSession(conv: {
  id: string;
  contactId: string | null;
  channel: string;
  lastInboundAt: Date | null;
}): Promise<ChannelSessionInfo> {
  let lastInboundAt = conv.lastInboundAt;
  if (!lastInboundAt) {
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
    lastInboundAt = lastInMsg?.createdAt ?? null;
  }
  return sessionFromLastInbound(lastInboundAt);
}

/**
 * Janela de 24h da Meta para o par (contato, canal): última inbound do
 * contato NAQUELE canal = MAX(conversation.lastInboundAt) entre as
 * conversas com channelId; se nenhuma tiver, fallback para a última
 * message direction='in' nelas (mesmo critério do GET messages).
 * Sem conversa/inbound no canal → active: false, lastInboundAt: null.
 */
export async function getContactChannelSession(
  contactId: string,
  channelId: string,
): Promise<ChannelSessionInfo> {
  const convs = await prisma.conversation.findMany({
    where: { contactId, channelId },
    select: { id: true, lastInboundAt: true },
  });

  let lastInboundAt: Date | null = null;
  for (const c of convs) {
    if (c.lastInboundAt && (!lastInboundAt || c.lastInboundAt > lastInboundAt)) {
      lastInboundAt = c.lastInboundAt;
    }
  }

  if (!lastInboundAt && convs.length > 0) {
    const lastInMsg = await prisma.message.findFirst({
      where: { conversationId: { in: convs.map((c) => c.id) }, direction: "in" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    lastInboundAt = lastInMsg?.createdAt ?? null;
  }

  return sessionFromLastInbound(lastInboundAt);
}
