/**
 * Detecta atendimento ativo — usado para:
 *  - não disparar automação/salesbot em cima do consultor ou da IA
 *  - não deixar IA “roubar” conversa já atribuída a humano
 */

import { prisma } from "@/lib/prisma";

export type HumanAttendanceSnapshot = {
  conversationId: string | null;
  hasHumanReply: boolean;
  assignedToId: string | null;
  assigneeType: string | null;
  /** true se humano é o dono atual OU já respondeu nesta conversa. */
  humanAttending: boolean;
  /**
   * true se salesbot/INICIO-PIPE não deve falar:
   * humano em atendimento OU já há responsável (humano/IA) no chat.
   */
  suppressAutomation: boolean;
};

function toSnapshot(conv: {
  id: string;
  hasHumanReply: boolean;
  assignedToId: string | null;
  assignedTo: { type: string } | null;
}): HumanAttendanceSnapshot {
  const assigneeType = conv.assignedTo?.type ?? null;
  const humanOwner = Boolean(conv.assignedToId) && assigneeType === "HUMAN";
  const humanAttending = Boolean(conv.hasHumanReply) || humanOwner;
  const suppressAutomation =
    Boolean(conv.hasHumanReply) || Boolean(conv.assignedToId);

  return {
    conversationId: conv.id,
    hasHumanReply: Boolean(conv.hasHumanReply),
    assignedToId: conv.assignedToId,
    assigneeType,
    humanAttending,
    suppressAutomation,
  };
}

/**
 * Conversa aberta mais recente do contato (não RESOLVED).
 */
export async function getHumanAttendanceForContact(
  contactId: string,
): Promise<HumanAttendanceSnapshot | null> {
  const conv = await prisma.conversation.findFirst({
    where: { contactId, status: { not: "RESOLVED" } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      hasHumanReply: true,
      assignedToId: true,
      assignedTo: { select: { type: true } },
    },
  });
  if (!conv) return null;
  return toSnapshot(conv);
}

export async function getHumanAttendanceForConversation(
  conversationId: string,
): Promise<HumanAttendanceSnapshot | null> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      hasHumanReply: true,
      assignedToId: true,
      assignedTo: { select: { type: true } },
    },
  });
  if (!conv) return null;
  return toSnapshot(conv);
}
