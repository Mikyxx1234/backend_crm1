/**
 * Verifica se um userId humano ainda está elegível na Distribuição
 * (ONLINE, horário, fila, participa). Agentes IA retornam
 * `eligible: false` + `isAi: true` — nunca fecham fila humana.
 */

import { prisma } from "@/lib/prisma";
import { getDistributionResponsibles } from "@/services/distribution/responsibles";

export async function isAssigneeCurrentlyEligible(
  userId: string,
): Promise<{ eligible: boolean; isAi: boolean; reason?: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, type: true },
  });
  if (!user) return { eligible: false, isAi: false, reason: "USER_NOT_FOUND" };
  if (user.type === "AI") return { eligible: false, isAi: true, reason: "AI_NOT_HUMAN_DISTRIBUTION" };

  try {
    const views = await getDistributionResponsibles();
    const view = views.find((r) => r.userId === userId);
    if (!view) {
      // Humano fora do módulo de distribuição: não herdar automaticamente.
      return { eligible: false, isAi: false, reason: "NOT_IN_DISTRIBUTION" };
    }
    if (!view.eligible) {
      return {
        eligible: false,
        isAi: false,
        reason: view.blockedReasons[0] ?? "INELIGIBLE",
      };
    }
    return { eligible: true, isAi: false };
  } catch {
    // Sem widget / erro: conservador — não herda offline.
    return { eligible: false, isAi: false, reason: "ELIGIBILITY_CHECK_FAILED" };
  }
}

/** Limpa dono em conversa + contato + deals OPEN (para redistribuir). */
export async function clearOwnershipForRedistribution(args: {
  conversationId: string;
  contactId: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.conversation.update({
      where: { id: args.conversationId },
      data: { assignedToId: null },
    });
    await tx.contact.update({
      where: { id: args.contactId },
      data: { assignedToId: null },
    });
    await tx.deal.updateMany({
      where: { contactId: args.contactId, status: "OPEN" },
      data: { ownerId: null },
    });
  });
}
