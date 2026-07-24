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
 * Critério da fila = atendimentos ABERTOS SEM responsável (`assignedToId=null`).
 *
 * NÃO usamos `hasAgentReply` de propósito: uma resposta de AUTOMAÇÃO/IA marca
 * `hasAgentReply=true` e tiraria o lead da aba "Entrada", mas ele continua SEM
 * responsável humano e PRECISA ser distribuído. A distribuição propaga o
 * responsável para a conversa (`assignedToId`), então `null` = ainda não
 * distribuído — independente de automação/IA já ter interagido.
 */
const ABERTA_SEM_RESPONSAVEL: Prisma.ConversationWhereInput = {
  status: "OPEN",
  assignedToId: null,
};

export async function getPendingDistributions(): Promise<
  PendingDistributionView[]
> {
  const items = await prisma.conversation.findMany({
    where: ABERTA_SEM_RESPONSAVEL,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      contactId: true,
      createdAt: true,
      updatedAt: true,
      contact: { select: { name: true, phone: true } },
    },
  });

  return items.map((c) => ({
    id: c.id,
    dealId: null,
    contactId: c.contactId,
    // Exibe o TELEFONE (mais útil/discreto na fila); cai pro nome se não houver.
    label: c.contact?.phone || c.contact?.name || "Atendimento",
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
    where: ABERTA_SEM_RESPONSAVEL,
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
    where: ABERTA_SEM_RESPONSAVEL,
  });

  return { resolved, cancelled: 0, pending };
}
