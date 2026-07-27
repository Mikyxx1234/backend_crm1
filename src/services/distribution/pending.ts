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
  /** Canal de origem da conversa (WHATSAPP, INSTAGRAM, FACEBOOK, EMAIL, WEBCHAT). */
  channel: string;
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
      channel: true,
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
    channel: c.channel ?? "",
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
 * Após criar um NOVO ticket OPEN inbound (modelo: RESOLVED não reabre),
 * tenta distribuir imediatamente se ainda não há responsável.
 *
 * Cobre o caso Anna: distribuição falhou de manhã → ticket RESOLVED sem
 * assign → aluno volta → novo #N sem `execute_distribution` da automação.
 * Remapeia `distribution_pending` órfãs para o conversationId novo.
 *
 * Nunca propaga erro ao webhook — falha só loga.
 */
export async function maybeDistributeNewInboundTicket(input: {
  conversationId: string;
  contactId: string;
  assignedToId?: string | null;
}): Promise<void> {
  // #region agent log
  console.warn(
    "[DBG-e46688 maybeDist] entry",
    JSON.stringify({
      convId: input.conversationId,
      contactId: input.contactId,
      alreadyAssigned: !!input.assignedToId,
    }),
  );
  // #endregion
  if (input.assignedToId) return;

  try {
    const widgetActive = await hasOrganizationWidget("smart_distribution");
    // #region agent log
    console.warn(
      "[DBG-e46688 maybeDist] widget check",
      JSON.stringify({ widgetActive, convId: input.conversationId }),
    );
    // #endregion
    if (!widgetActive) return;

    const remapped = await prisma.distributionPending.updateMany({
      where: { status: "PENDING", contactId: input.contactId },
      data: {
        conversationId: input.conversationId,
        lastAttemptAt: new Date(),
      },
    });

    const result = await executeDistribution({
      dealId: null,
      contactId: input.contactId,
      conversationId: input.conversationId,
      distributionType: null,
      triggerSource: "SYSTEM",
    });
    // #region agent log
    console.warn(
      "[DBG-e46688 maybeDist] result",
      JSON.stringify({
        convId: input.conversationId,
        remappedPending: remapped.count,
        success: result.success,
        reason: result.reason,
        selectedUserId: result.selectedUserId,
      }),
    );
    // #endregion
  } catch (e) {
    console.error("[distribution] maybeDistributeNewInboundTicket failed", e);
    // #region agent log
    console.warn(
      "[DBG-e46688 maybeDist] threw",
      JSON.stringify({
        convId: input.conversationId,
        err: e instanceof Error ? e.message : String(e),
      }),
    );
    // #endregion
  }
}

/**
 * Drena a fila de espera: re-tenta distribuir cada pendência. Chamada quando
 * alguém fica ONLINE (e exposta via POST /api/distribution/pending/retry).
 * Idempotente e segura: se o módulo estiver desabilitado, não faz nada.
 */
export async function retryPendingDistributions(): Promise<RetryResult> {
  const widgetActive = await hasOrganizationWidget("smart_distribution");
  // #region agent log
  console.warn(
    "[DBG-e46688 retry] widget check",
    JSON.stringify({ widgetActive }),
  );
  // #endregion
  if (!widgetActive) {
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

  // #region agent log
  console.warn(
    "[DBG-e46688 retry] items found",
    JSON.stringify({
      count: items.length,
      firstIds: items.slice(0, 5).map((i) => i.id),
    }),
  );
  // #endregion

  let resolved = 0;

  for (const it of items) {
    const result = await executeDistribution({
      dealId: null,
      contactId: it.contactId,
      conversationId: it.id,
      distributionType: null,
      triggerSource: "SYSTEM",
    });
    // #region agent log
    console.warn(
      "[DBG-e46688 retry] executeDistribution",
      JSON.stringify({
        convId: it.id,
        success: result.success,
        reason: result.reason,
        selectedUserId: result.selectedUserId,
      }),
    );
    // #endregion
    if (result.success) resolved++;
  }

  const pending = await prisma.conversation.count({
    where: ABERTA_SEM_RESPONSAVEL,
  });

  return { resolved, cancelled: 0, pending };
}
