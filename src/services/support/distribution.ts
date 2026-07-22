/**
 * Distribuição do chat interno de suporte.
 *
 * Regra (v1): ao abrir/enfileirar um ticket, atribuímos ao agente do
 * departamento de suporte que esteja ONLINE e com MENOS tickets abertos
 * (balanceamento de carga). Se nenhum agente estiver online, o ticket
 * fica em PENDING (fila) e é distribuído quando um agente ficar online
 * (`drainSupportQueue`, chamado pela rota de presença).
 */

import { prisma } from "@/lib/prisma";

/** Departamento marcado como de suporte para a org (ou null). */
export async function getSupportDepartment(orgId: string) {
  return prisma.department.findFirst({
    where: { organizationId: orgId, isSupport: true },
    select: { id: true, name: true },
  });
}

/**
 * Escolhe o agente ONLINE do departamento de suporte com menos tickets
 * abertos. Retorna null se não houver ninguém elegível/online.
 */
export async function pickLeastBusyAgent(
  orgId: string,
  departmentId: string,
): Promise<string | null> {
  const members = await prisma.departmentMember.findMany({
    where: { organizationId: orgId, departmentId },
    select: { userId: true },
  });
  const memberIds = members.map((m) => m.userId);
  if (memberIds.length === 0) return null;

  // Filtra membros humanos, ativos e ONLINE.
  const users = await prisma.user.findMany({
    where: {
      id: { in: memberIds },
      organizationId: orgId,
      type: "HUMAN",
      isErased: false,
    },
    select: { id: true },
  });
  const humanIds = users.map((u) => u.id);
  if (humanIds.length === 0) return null;

  const online = await prisma.agentStatus.findMany({
    where: { userId: { in: humanIds }, status: "ONLINE" },
    select: { userId: true },
  });
  const onlineIds = online.map((o) => o.userId);
  if (onlineIds.length === 0) return null;

  // Contagem de tickets OPEN por agente candidato.
  const grouped = await prisma.supportTicket.groupBy({
    by: ["assignedToId"],
    where: { assignedToId: { in: onlineIds }, status: "OPEN" },
    _count: { _all: true },
  });
  const countByAgent = new Map<string, number>();
  for (const g of grouped) {
    if (g.assignedToId) countByAgent.set(g.assignedToId, g._count._all);
  }

  // Menor carga vence; empate mantém a ordem (estável).
  let best: string | null = null;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const id of onlineIds) {
    const c = countByAgent.get(id) ?? 0;
    if (c < bestCount) {
      best = id;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Tenta atribuir um ticket a um agente disponível. Muta e retorna o
 * ticket atualizado (status OPEN + assignedTo) ou o ticket mantido em
 * PENDING quando não há agente online.
 */
export async function tryAssignTicket(orgId: string, ticketId: string) {
  const dept = await getSupportDepartment(orgId);
  const departmentId = dept?.id ?? null;

  const agentId = departmentId
    ? await pickLeastBusyAgent(orgId, departmentId)
    : null;

  return prisma.supportTicket.update({
    where: { id: ticketId },
    data: agentId
      ? { assignedToId: agentId, status: "OPEN", departmentId }
      : { status: "PENDING", departmentId },
  });
}

/**
 * Drena a fila (tickets PENDING) da org, distribuindo para agentes que
 * ficaram online. Chamado pela rota de presença quando um agente muda
 * para ONLINE. Retorna os ids dos tickets atribuídos.
 */
export async function drainSupportQueue(orgId: string): Promise<string[]> {
  const dept = await getSupportDepartment(orgId);
  if (!dept) return [];

  const pending = await prisma.supportTicket.findMany({
    where: { organizationId: orgId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (pending.length === 0) return [];

  const assigned: string[] = [];
  for (const t of pending) {
    const agentId = await pickLeastBusyAgent(orgId, dept.id);
    if (!agentId) break; // ninguém disponível — para de drenar
    await prisma.supportTicket.update({
      where: { id: t.id },
      data: { assignedToId: agentId, status: "OPEN", departmentId: dept.id },
    });
    assigned.push(t.id);
  }
  return assigned;
}
