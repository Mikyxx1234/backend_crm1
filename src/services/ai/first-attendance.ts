/**
 * Primeiro atendimento por Agente IA.
 *
 * Quando a conversa (e o contato) estão sem responsável, atribui a um
 * agente IA ativo (preferência: arquétipo ATENDIMENTO + AUTONOMOUS).
 * Substitui o “início de pipe / salesbot” para dúvidas do aluno —
 * a distribuição humana só entra no handoff.
 *
 * Sem migration: elegibilidade via AIAgentConfig já existente + org
 * setting opcional `ai.firstAttendanceUserId` (força um agente).
 * Desliga com `ai.firstAttendanceEnabled=false`.
 */

import { getOrgSetting } from "@/lib/org-settings";
import { prisma } from "@/lib/prisma";

function logAi(event: string, payload: Record<string, unknown>) {
  console.info(
    "[ai-attend]",
    JSON.stringify({ event, ts: new Date().toISOString(), ...payload }),
  );
}

async function isFirstAttendanceEnabled(): Promise<boolean> {
  try {
    const raw = await getOrgSetting("ai.firstAttendanceEnabled");
    if (raw == null || raw === "") return true;
    return !["0", "false", "off", "no"].includes(raw.trim().toLowerCase());
  } catch {
    return true;
  }
}

async function resolveFirstAttendanceUserId(): Promise<string | null> {
  try {
    const forced = await getOrgSetting("ai.firstAttendanceUserId");
    if (forced?.trim()) {
      const u = await prisma.user.findFirst({
        where: {
          id: forced.trim(),
          type: "AI",
          aiAgentConfig: { active: true, autonomyMode: "AUTONOMOUS" },
        },
        select: { id: true },
      });
      if (u) return u.id;
    }
  } catch {
    /* fora de RequestContext */
  }

  const preferred = await prisma.aIAgentConfig.findFirst({
    where: {
      active: true,
      autonomyMode: "AUTONOMOUS",
      archetype: "ATENDIMENTO",
    },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  if (preferred) return preferred.userId;

  const any = await prisma.aIAgentConfig.findFirst({
    where: { active: true, autonomyMode: "AUTONOMOUS" },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  return any?.userId ?? null;
}

/**
 * Se a conversa está sem assignee, atribui ao agente de 1º atendimento.
 * Também alinha contato + deals OPEN (mesma regra do assign do inbox).
 * @returns userId da IA se atribuiu; null se não aplicável.
 */
export async function tryAssignFirstAttendanceAi(args: {
  conversationId: string;
  contactId: string;
  assignedToId?: string | null;
}): Promise<string | null> {
  if (args.assignedToId) return null;
  if (!(await isFirstAttendanceEnabled())) {
    logAi("first_attendance_disabled", {
      conversationId: args.conversationId,
    });
    return null;
  }

  const conv = await prisma.conversation.findUnique({
    where: { id: args.conversationId },
    select: { assignedToId: true, contactId: true },
  });
  if (!conv || conv.assignedToId) return null;

  const aiUserId = await resolveFirstAttendanceUserId();
  if (!aiUserId) {
    logAi("first_attendance_no_agent", {
      conversationId: args.conversationId,
    });
    return null;
  }

  const contactId = conv.contactId ?? args.contactId;

  await prisma.$transaction(async (tx) => {
    await tx.conversation.update({
      where: { id: args.conversationId },
      data: {
        assignedToId: aiUserId,
        aiGreetedAt: null,
      },
    });
    if (contactId) {
      await tx.contact.update({
        where: { id: contactId },
        data: { assignedToId: aiUserId },
      });
      await tx.deal.updateMany({
        where: { contactId, status: "OPEN" },
        data: { ownerId: aiUserId },
      });
    }
  });

  logAi("first_attendance_assigned", {
    conversationId: args.conversationId,
    contactId,
    aiUserId,
  });
  return aiUserId;
}
