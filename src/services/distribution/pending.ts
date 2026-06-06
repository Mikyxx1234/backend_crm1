/**
 * Fila de espera da Distribuição (DistributionPending).
 *
 * Leads que não puderam ser distribuídos (NO_ELIGIBLE_RESPONSIBLE) ficam
 * registrados aqui. Quando alguém volta a ficar ONLINE, `retryPendingDistributions`
 * re-roda o motor para cada pendência — se conseguir atribuir, o próprio
 * `executeDistribution` marca o registro como RESOLVED.
 *
 * Import unidirecional: pending → engine (engine NÃO importa pending; ele usa
 * helpers internos de enqueue/resolve). Evita ciclo de import.
 */

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

export async function getPendingDistributions(): Promise<
  PendingDistributionView[]
> {
  const items = await prisma.distributionPending.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      dealId: true,
      contactId: true,
      distributionType: true,
      triggerSource: true,
      attempts: true,
      lastAttemptAt: true,
      createdAt: true,
    },
  });
  if (items.length === 0) return [];

  const dealIds = items.flatMap((i) => (i.dealId ? [i.dealId] : []));
  const contactIds = items.flatMap((i) =>
    !i.dealId && i.contactId ? [i.contactId] : [],
  );

  const [deals, contacts] = await Promise.all([
    dealIds.length
      ? prisma.deal.findMany({
          where: { id: { in: dealIds } },
          select: { id: true, title: true, contact: { select: { name: true } } },
        })
      : Promise.resolve([]),
    contactIds.length
      ? prisma.contact.findMany({
          where: { id: { in: contactIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const dealMap = new Map(deals.map((d) => [d.id, d]));
  const contactMap = new Map(contacts.map((c) => [c.id, c.name]));

  return items.map((i) => {
    let label = "Lead";
    if (i.dealId) {
      const d = dealMap.get(i.dealId);
      label = d?.title || d?.contact?.name || "Negócio";
    } else if (i.contactId) {
      label = contactMap.get(i.contactId) || "Contato";
    }
    return {
      id: i.id,
      dealId: i.dealId,
      contactId: i.contactId,
      label,
      distributionType: i.distributionType,
      triggerSource: i.triggerSource,
      attempts: i.attempts,
      lastAttemptAt: i.lastAttemptAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    };
  });
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

  const items = await prisma.distributionPending.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      dealId: true,
      contactId: true,
      conversationId: true,
      distributionType: true,
    },
  });

  let resolved = 0;
  let cancelled = 0;

  for (const it of items) {
    // Se o negócio não existe mais ou já saiu de OPEN (foi atribuído/fechado
    // por outro caminho), a pendência perdeu o sentido → cancela.
    if (it.dealId) {
      const deal = await prisma.deal.findUnique({
        where: { id: it.dealId },
        select: { status: true },
      });
      if (!deal || deal.status !== "OPEN") {
        await prisma.distributionPending.update({
          where: { id: it.id },
          data: { status: "CANCELLED", resolvedAt: new Date() },
        });
        cancelled++;
        continue;
      }
    }

    const result = await executeDistribution({
      dealId: it.dealId,
      contactId: it.contactId,
      conversationId: it.conversationId,
      distributionType: it.distributionType,
      triggerSource: "SYSTEM",
    });
    // Em sucesso, executeDistribution já marcou a pendência como RESOLVED.
    if (result.success) resolved++;
  }

  const pending = await prisma.distributionPending.count({
    where: { status: "PENDING" },
  });

  return { resolved, cancelled, pending };
}
