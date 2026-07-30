/**
 * Fila de espera da Distribuição.
 *
 * A fila reflete os ATENDIMENTOS da aba "Entrada" que ainda estão SEM
 * responsável (conversa aberta, sem `assignedToId`). Deriva do mesmo
 * critério da aba Entrada do inbox. A drenagem automática passa por
 * `processPendingDistributionQueue` (gatilhos: novo item, agente online,
 * elegibilidade, capacidade liberada, botão manual, cron de segurança).
 *
 * Import unidirecional: pending → engine (evita ciclo de import).
 * O engine agenda drenagem via import dinâmico.
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  getOrgIdOrNull,
  runWithContext,
} from "@/lib/request-context";
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
  trigger?: PendingQueueTrigger;
}

export type PendingQueueTrigger =
  | "new_item"
  | "agent_online"
  | "agent_eligible"
  | "capacity_released"
  | "manual"
  | "scheduled";

/** Debounce / lock in-memory por org (sem schema novo). */
const drainState = new Map<
  string,
  {
    running: boolean;
    queuedTrigger: PendingQueueTrigger | null;
    timer: ReturnType<typeof setTimeout> | null;
  }
>();

function getDrainState(orgId: string) {
  let s = drainState.get(orgId);
  if (!s) {
    s = { running: false, queuedTrigger: null, timer: null };
    drainState.set(orgId, s);
  }
  return s;
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
import { tryAssignFirstAttendanceAi } from "@/services/ai/first-attendance";

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

  // 1º atendimento: Agente IA (se houver ativo) assume antes da fila humana.
  try {
    const aiUserId = await tryAssignFirstAttendanceAi({
      conversationId: input.conversationId,
      contactId: input.contactId,
      assignedToId: input.assignedToId,
    });
    if (aiUserId) {
      console.warn(
        "[DBG-e46688 maybeDist] first_attendance_ai",
        JSON.stringify({
          convId: input.conversationId,
          aiUserId,
        }),
      );
      return;
    }
  } catch (e) {
    console.error("[ai] tryAssignFirstAttendanceAi failed", e);
  }

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

    // Se ninguém elegível (ou corrida com presença), agenda drenagem da fila.
    if (!result.success) {
      scheduleProcessPendingDistributionQueue({
        trigger: "new_item",
        delayMs: 2000,
      });
    }
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
    scheduleProcessPendingDistributionQueue({
      trigger: "new_item",
      delayMs: 2000,
    });
  }
}

/**
 * Função central de drenagem da fila de espera.
 * Reutiliza o motor `executeDistribution` (mesmas regras de elegibilidade).
 * Idempotente; segura se o módulo estiver desabilitado.
 */
export async function processPendingDistributionQueue(opts: {
  trigger: PendingQueueTrigger;
}): Promise<RetryResult> {
  const orgId = getOrgIdOrNull();
  if (!orgId) {
    return { resolved: 0, cancelled: 0, pending: 0, trigger: opts.trigger };
  }

  const state = getDrainState(orgId);
  if (state.running) {
    // Coalesca: marca para re-rodar ao terminar (pode ter entrado item novo).
    state.queuedTrigger = opts.trigger;
    const pending = await prisma.conversation.count({
      where: ABERTA_SEM_RESPONSAVEL,
    });
    return { resolved: 0, cancelled: 0, pending, trigger: opts.trigger };
  }

  state.running = true;
  try {
    const widgetActive = await hasOrganizationWidget("smart_distribution");
    // #region agent log
    console.warn(
      "[DBG-e46688 retry] widget check",
      JSON.stringify({ widgetActive, trigger: opts.trigger }),
    );
    // #endregion
    if (!widgetActive) {
      return { resolved: 0, cancelled: 0, pending: 0, trigger: opts.trigger };
    }

    const items = await prisma.conversation.findMany({
      where: ABERTA_SEM_RESPONSAVEL,
      orderBy: { createdAt: "asc" },
      select: { id: true, contactId: true },
      take: 200,
    });

    // #region agent log
    console.warn(
      "[DBG-e46688 retry] items found",
      JSON.stringify({
        count: items.length,
        firstIds: items.slice(0, 5).map((i) => i.id),
        trigger: opts.trigger,
      }),
    );
    // #endregion

    let resolved = 0;

    for (const it of items) {
      try {
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
      } catch (e) {
        console.error(
          "[distribution] processPendingDistributionQueue item failed",
          { conversationId: it.id, trigger: opts.trigger, err: e },
        );
      }
    }

    const pending = await prisma.conversation.count({
      where: ABERTA_SEM_RESPONSAVEL,
    });

    if (resolved > 0 || opts.trigger === "manual" || opts.trigger === "scheduled") {
      console.info(
        "[distribution] processPendingDistributionQueue",
        JSON.stringify({
          orgId,
          trigger: opts.trigger,
          resolved,
          pending,
          scanned: items.length,
        }),
      );
    }

    return { resolved, cancelled: 0, pending, trigger: opts.trigger };
  } finally {
    state.running = false;
    const queued = state.queuedTrigger;
    state.queuedTrigger = null;
    if (queued) {
      // Reprocessa o que chegou durante a execução (sem empilhar timers).
      scheduleProcessPendingDistributionQueue({
        trigger: queued,
        delayMs: 250,
      });
    }
  }
}

/**
 * Compat: botão "Reprocessar agora" e callers legados.
 */
export async function retryPendingDistributions(): Promise<RetryResult> {
  return processPendingDistributionQueue({ trigger: "manual" });
}

/**
 * Agenda drenagem sem bloquear o caller (presença, enqueue, PATCH, etc.).
 * Debounce por org: vários gatilhos próximos viram uma única execução.
 */
export function scheduleProcessPendingDistributionQueue(opts: {
  trigger: PendingQueueTrigger;
  /** Default 500ms — agrupa rajadas (ex.: vários leads entrando juntos). */
  delayMs?: number;
}): void {
  const orgId = getOrgIdOrNull();
  if (!orgId) return;

  const delayMs = opts.delayMs ?? 500;
  const state = getDrainState(orgId);
  state.queuedTrigger = opts.trigger;

  if (state.timer) {
    clearTimeout(state.timer);
  }

  state.timer = setTimeout(() => {
    state.timer = null;
    const trigger = state.queuedTrigger ?? opts.trigger;
    state.queuedTrigger = null;

    void runWithContext(
      {
        organizationId: orgId,
        userId: "system",
        isSuperAdmin: false,
        actor: {
          type: "SYSTEM",
          label: "Distribuição Inteligente",
          sublabel: `queue:${trigger}`,
        },
      },
      () => processPendingDistributionQueue({ trigger }),
    ).catch((e) => {
      console.error(
        "[distribution] scheduleProcessPendingDistributionQueue failed",
        e,
      );
    });
  }, delayMs);

  // Evita manter o processo Node vivo só por causa do timer em testes/scripts.
  if (typeof state.timer === "object" && state.timer && "unref" in state.timer) {
    try {
      state.timer.unref();
    } catch {
      /* ignore */
    }
  }
}
