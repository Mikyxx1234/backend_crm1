/**
 * Fila de espera da Distribuição.
 *
 * A fila reflete os ATENDIMENTOS da aba "Entrada" que ainda estão SEM
 * responsável (conversa aberta, sem resposta da equipe, sem erro e sem
 * `assignedToId`). Deriva do mesmo critério da aba Entrada do inbox, para a
 * contagem bater com o que o operador vê. Quando alguém fica ONLINE,
 * `retryPendingDistributions` re-roda o motor para cada atendimento — em
 * sucesso, a distribuição atribui o responsável e o item sai da fila.
 *
 * Import unidirecional: pending → engine (evita ciclo de import).
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { hasOrganizationWidget } from "@/services/organization-widgets";

import { executeDistribution } from "./engine";

export interface PendingDistributionView {
  id: string;
  dealId: string | null;
  contactId: string | null;
  /** Nome amigável: título do negócio, nome do contato, ou fallback. */
  label: string;
  distributionType: string | null;
  triggerSource: string;
  attempts: number;
  lastAttemptAt: string;
  createdAt: string;
}

/**
 * Critério da fila = atendimentos da aba "Entrada" SEM responsável:
 * conversa aberta, sem resposta da equipe, sem erro e sem responsável
 * atribuído (a distribuição propaga o responsável para a conversa via
 * `assignedToId`, então `null` = ainda não distribuído). Deriva do mesmo
 * critério da aba Entrada do inbox — a contagem bate com o que o operador vê.
 */
const ENTRADA_SEM_RESPONSAVEL: Prisma.ConversationWhereInput = {
  status: "OPEN",
  hasAgentReply: false,
  hasError: false,
  assignedToId: null,
};

export async function getPendingDistributions(): Promise<
  PendingDistributionView[]
> {
  const items = await prisma.conversation.findMany({
    where: ENTRADA_SEM_RESPONSAVEL,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      contactId: true,
      createdAt: true,
      updatedAt: true,
      contact: { select: { name: true } },
    },
  });

  return items.map((c) => ({
    id: c.id,
    dealId: null,
    contactId: c.contactId,
    label: c.contact?.name || "Atendimento",
    distributionType: null,
    triggerSource: "INBOUND",
    attempts: 0,
    lastAttemptAt: c.updatedAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
  }));
}

export interface RetryResult {
  resolved: number;
  cancelled: number;
  pending: number;
}

/**
 * Drena a fila de espera: re-tenta distribuir cada pendência. Chamada quando
 * alguém fica ONLINE (e exposta via POST /api/distribution/pending/retry).
 * Idempotente e segura: se o módulo estiver desabilitado, não faz nada.
 */
export async function retryPendingDistributions(): Promise<RetryResult> {
  if (!(await hasOrganizationWidget("smart_distribution"))) {
    return { resolved: 0, cancelled: 0, pending: 0 };
  }

  // Re-tenta distribuir cada atendimento de Entrada sem responsável. Em
  // sucesso, a distribuição atribui o responsável (propaga para a conversa),
  // e o item sai naturalmente da fila (assignedToId deixa de ser null).
  const items = await prisma.conversation.findMany({
    where: ENTRADA_SEM_RESPONSAVEL,
    orderBy: { createdAt: "asc" },
    select: { id: true, contactId: true },
  });

  let resolved = 0;

  for (const it of items) {
    const result = await executeDistribution({
      dealId: null,
      contactId: it.contactId,
      conversationId: it.id,
      distributionType: null,
      triggerSource: "SYSTEM",
    });
    if (result.success) resolved++;
  }

  const pending = await prisma.conversation.count({
    where: ENTRADA_SEM_RESPONSAVEL,
  });

  return { resolved, cancelled: 0, pending };
}
