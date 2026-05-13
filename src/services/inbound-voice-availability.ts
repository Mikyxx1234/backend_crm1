import { prisma } from "@/lib/prisma";
import { isAgentAvailable } from "@/services/lead-distribution";

/**
 * Agentes elegíveis para receber ligações WhatsApp (Calling): ONLINE, opt-in voz,
 * e dentro do horário/agenda configurados.
 */
export async function getUserIdsAvailableForInboundVoice(): Promise<string[]> {
  const rows = await prisma.agentStatus.findMany({
    where: {
      availableForVoiceCalls: true,
      status: "ONLINE",
    },
    select: { userId: true },
  });

  const eligible: string[] = [];
  for (const r of rows) {
    if (await isAgentAvailable(r.userId)) eligible.push(r.userId);
  }
  return eligible;
}

export async function listInboundVoiceAgents(): Promise<
  { userId: string; name: string; email: string }[]
> {
  const ids = await getUserIdsAvailableForInboundVoice();
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  return users.map((u) => ({ userId: u.id, name: u.name, email: u.email }));
}
