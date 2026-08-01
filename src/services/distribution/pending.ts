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

import { tryAssignFirstAttendanceAi } from "@/services/ai/first-attendance";
import {
  clearOwnershipForRedistribution,
  isAssigneeCurrentlyEligible,
} from "@/services/distribution/assignee-eligibility";

import { executeDistribution } from "./engine";
import { getDistributionResponsibles } from "./responsibles";

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

  if (items.length === 0) return [];

  const convIds = items.map((c) => c.id);
  const contactIds = items
    .map((c) => c.contactId)
    .filter((id): id is string => Boolean(id));

  // Origem real da solicitação (ex.: AI_AGENT) — a aba "Aguardando" lista
  // conversas OPEN sem assignee; o meta vem da pendência do motor.
  const pendRows = await prisma.distributionPending.findMany({
    where: {
      status: "PENDING",
      OR: [
        { conversationId: { in: convIds } },
        ...(contactIds.length > 0 ? [{ contactId: { in: contactIds } }] : []),
      ],
    },
    select: {
      conversationId: true,
      contactId: true,
      triggerSource: true,
      attempts: true,
      lastAttemptAt: true,
      distributionType: true,
      dealId: true,
      createdAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const byConv = new Map<string, (typeof pendRows)[number]>();
  const byContact = new Map<string, (typeof pendRows)[number]>();
  for (const row of pendRows) {
    if (row.conversationId && !byConv.has(row.conversationId)) {
      byConv.set(row.conversationId, row);
    }
    if (row.contactId && !byContact.has(row.contactId)) {
      byContact.set(row.contactId, row);
    }
  }

  return items.map((c) => {
    const meta =
      byConv.get(c.id) ??
      (c.contactId ? byContact.get(c.contactId) : undefined) ??
      null;
    return {
      id: c.id,
      dealId: meta?.dealId ?? null,
      contactId: c.contactId,
      label: c.contact?.phone || c.contact?.name || "Atendimento",
      channel: c.channel ?? "",
      distributionType: meta?.distributionType ?? null,
      triggerSource: meta?.triggerSource ?? "INBOUND",
      attempts: meta?.attempts ?? 0,
      lastAttemptAt: (meta?.lastAttemptAt ?? c.updatedAt).toISOString(),
      createdAt: (meta?.createdAt ?? c.createdAt).toISOString(),
    };
  });
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
 * Marca como RESOLVED as pendências cuja conversa NÃO precisa mais ser
 * distribuída — ou seja, saiu do universo `ABERTA_SEM_RESPONSAVEL`. Cobre:
 *
 *   - Conversa encerrada por qualquer via (status != OPEN)
 *   - Conversa OPEN mas já atribuída por outro caminho (agente manual,
 *     herança de contato/deal, `maybeAssignExisting…`)
 *   - Conversa deletada
 *
 * Sem essa limpeza, o motor rescheduling ficava batendo em pendências
 * fantasma (uma delas chegou a `attempts=1077` em prod — Cruzeiro EaD
 * 2026-07-30) e a "fila de espera" do dashboard mostrava valores enganosos.
 * `resolvedUserId=null` marca que foi cleanup, não distribuição real.
 *
 * Idempotente e barata (uma consulta com IN() + updateMany).
 */
async function cancelStalePendingOrphans(orgId: string): Promise<number> {
  const stale = await prisma.distributionPending.findMany({
    where: {
      organizationId: orgId,
      status: "PENDING",
      conversationId: { not: null },
    },
    select: { id: true, conversationId: true },
  });
  if (stale.length === 0) return 0;

  const convIds = stale
    .map((p) => p.conversationId)
    .filter((id): id is string => Boolean(id));

  const stillActive = await prisma.conversation.findMany({
    where: {
      id: { in: convIds },
      status: "OPEN",
      assignedToId: null,
    },
    select: { id: true },
  });
  const activeSet = new Set(stillActive.map((c) => c.id));

  const toResolve = stale
    .filter((p) => !p.conversationId || !activeSet.has(p.conversationId))
    .map((p) => p.id);
  if (toResolve.length === 0) return 0;

  const res = await prisma.distributionPending.updateMany({
    where: { id: { in: toResolve } },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
    },
  });
  return res.count;
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

  // Herança de contato/deal NÃO pode burlar elegibilidade: offline /
  // indisponível / fora do expediente devem cair na redistribuição (ou IA).
  let assignee = input.assignedToId ?? null;
  if (assignee) {
    const check = await isAssigneeCurrentlyEligible(assignee);
    // AI owner: keep regardless of eligible flag — first-attendance guard handles post-handoff.
    if (check.isAi) {
      console.warn(
        "[DBG-e46688 maybeDist] keep_ai_assignee",
        JSON.stringify({ convId: input.conversationId, assignee }),
      );
      return;
    }
    if (check.eligible) {
      // IA herdada: mantém. Humano elegível sem reply nesta conversa:
      // libera p/ 1º atendimento IA (substitui INICIO-PIPE).
      if (!check.isAi) {
        const conv = await prisma.conversation.findUnique({
          where: { id: input.conversationId },
          select: { hasHumanReply: true },
        });
        if (!conv?.hasHumanReply) {
          console.warn(
            "[DBG-e46688 maybeDist] release_human_for_first_attendance",
            JSON.stringify({
              convId: input.conversationId,
              assignee,
            }),
          );
          try {
            await clearOwnershipForRedistribution({
              conversationId: input.conversationId,
              contactId: input.contactId,
            });
          } catch (e) {
            console.error(
              "[distribution] clearOwnershipForRedistribution failed",
              e,
            );
            return;
          }
          assignee = null;
        } else {
          console.warn(
            "[DBG-e46688 maybeDist] keep_eligible_assignee",
            JSON.stringify({
              convId: input.conversationId,
              assignee,
              isAi: check.isAi,
            }),
          );
          return;
        }
      } else {
        console.warn(
          "[DBG-e46688 maybeDist] keep_eligible_assignee",
          JSON.stringify({
            convId: input.conversationId,
            assignee,
            isAi: check.isAi,
          }),
        );
        return;
      }
    } else {
      console.warn(
        "[DBG-e46688 maybeDist] clear_ineligible_assignee",
        JSON.stringify({
          convId: input.conversationId,
          assignee,
          reason: check.reason,
        }),
      );
      try {
        await clearOwnershipForRedistribution({
          conversationId: input.conversationId,
          contactId: input.contactId,
        });
      } catch (e) {
        console.error(
          "[distribution] clearOwnershipForRedistribution failed",
          e,
        );
        return;
      }
      assignee = null;
    }
  }

  // 1º atendimento: Agente IA (se houver ativo) assume antes da fila humana.
  try {
    const aiUserId = await tryAssignFirstAttendanceAi({
      conversationId: input.conversationId,
      contactId: input.contactId,
      assignedToId: assignee,
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

    const convDept = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { departmentId: true },
    });

    const result = await executeDistribution({
      dealId: null,
      contactId: input.contactId,
      conversationId: input.conversationId,
      distributionType: null,
      triggerSource: "SYSTEM",
      departmentId: convDept?.departmentId ?? null,
      // Fronteira de departamento ESTRITA: quando o lead foi roteado a um
      // departamento (ex.: handoff acadêmico), ele só é distribuído a quem
      // estiver disponível NAQUELE depto — se ninguém, espera na fila do depto
      // (nunca vai para outro). Leads SEM departamento já nascem org-wide
      // (departmentScoped=false), então não ficam presos.
      allowOrgWideFallback: false,
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

    // Sem elegíveis: deixa na fila e NÃO dispara retry em loop.
    // Drena só quando consultor ficar disponível / cron / manual.
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

    // Limpa pendências órfãs (conversa já encerrada / atribuída por outra via)
    // antes de tentar distribuir. Sem isso o registro fica em `PENDING`
    // eternamente e infla o dashboard com "aguardando" que não é fila real.
    let cancelledOrphans = 0;
    try {
      cancelledOrphans = await cancelStalePendingOrphans(orgId);
      if (cancelledOrphans > 0) {
        console.info(
          "[distribution] cancelStalePendingOrphans",
          JSON.stringify({ orgId, trigger: opts.trigger, cancelled: cancelledOrphans }),
        );
      }
    } catch (e) {
      console.warn("[distribution] cancelStalePendingOrphans failed", e);
    }

    // Gate: sem NENHUM consultor elegível agora, não percorre a fila
    // (evita centenas de executeDistribution → CPU / log spam).
    let anyEligible = false;
    try {
      const views = await getDistributionResponsibles();
      anyEligible = views.some((r) => r.eligible);
    } catch (e) {
      console.warn(
        "[distribution] processPending eligibility precheck failed",
        e,
      );
      anyEligible = false;
    }
    if (!anyEligible) {
      const pending = await prisma.conversation.count({
        where: ABERTA_SEM_RESPONSAVEL,
      });
      console.info(
        "[distribution] processPending skip — nenhum consultor elegível",
        JSON.stringify({ orgId, trigger: opts.trigger, pending, cancelledOrphans }),
      );
      // Mesmo sem elegíveis, cancelamento de órfãs conta como progresso.
      return {
        resolved: 0,
        cancelled: cancelledOrphans,
        pending,
        trigger: opts.trigger,
      };
    }

    const items = await prisma.conversation.findMany({
      where: ABERTA_SEM_RESPONSAVEL,
      orderBy: { createdAt: "asc" },
      select: { id: true, contactId: true, departmentId: true },
      take: 50,
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
    // Fronteira de departamento ESTRITA: cada departamento tem capacidade
    // independente. Em vez de parar o lote após N falhas seguidas (heurística
    // global antiga), pulamos os itens de departamentos já esgotados NESTA
    // passada — leads de um depto sem gente não impedem a drenagem de outro
    // depto que tem capacidade. Limita as chamadas a (resolvidos + nº de
    // departamentos distintos), evitando spam sem prender leads de outros deptos.
    const ORG_WIDE_KEY = "__org_wide__";
    const exhaustedDepartments = new Set<string>();

    for (const it of items) {
      const deptKey = it.departmentId ?? ORG_WIDE_KEY;
      if (exhaustedDepartments.has(deptKey)) continue;
      try {
        // Passa departmentId explícito → motor filtra por DepartmentMember
        // mesmo com distribution.respectDepartment=false (handoff acadêmico).
        const result = await executeDistribution({
          dealId: null,
          contactId: it.contactId,
          conversationId: it.id,
          distributionType: null,
          triggerSource: "SYSTEM",
          departmentId: it.departmentId,
          // Fronteira de departamento ESTRITA (ver maybeDistributeNewInboundTicket):
          // lead roteado a um depto espera por alguém DAQUELE depto; nunca vai
          // para outro. Sem departamento = org-wide desde o início.
          allowOrgWideFallback: false,
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
        if (result.success) {
          resolved++;
        } else if (
          result.reason === "NO_ELIGIBLE_RESPONSIBLE" ||
          result.reason === "NO_DEPARTMENT"
        ) {
          // Departamento sem ninguém elegível agora → não tenta os próximos
          // itens do MESMO depto nesta passada (drena quando alguém do depto
          // ficar disponível: agent_online / capacity_released / cron).
          exhaustedDepartments.add(deptKey);
        }
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

    if (
      resolved > 0 ||
      cancelledOrphans > 0 ||
      opts.trigger === "manual" ||
      opts.trigger === "scheduled"
    ) {
      console.info(
        "[distribution] processPendingDistributionQueue",
        JSON.stringify({
          orgId,
          trigger: opts.trigger,
          resolved,
          cancelledOrphans,
          pending,
          scanned: items.length,
        }),
      );
    }

    return { resolved, cancelled: cancelledOrphans, pending, trigger: opts.trigger };
  } finally {
    state.running = false;
    const queued = state.queuedTrigger;
    state.queuedTrigger = null;
    // Só re-drena se alguém ficou elegível / capacidade / manual.
    // `new_item` NÃO reentra sozinho — evita loop quando a fila está
    // cheia e ninguém ONLINE.
    if (
      queued &&
      (queued === "agent_online" ||
        queued === "agent_eligible" ||
        queued === "capacity_released" ||
        queued === "manual")
    ) {
      scheduleProcessPendingDistributionQueue({
        trigger: queued,
        delayMs: 500,
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
