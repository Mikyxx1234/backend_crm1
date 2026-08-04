/**
 * Fila de espera da Distribuição.
 *
 * A fila reflete os ATENDIMENTOS da aba "Entrada" que ainda estão SEM
 * responsável (conversa aberta, sem `assignedToId`). Deriva do mesmo
 * critério da aba Entrada do inbox. A drenagem automática passa por
 * `processPendingDistributionQueue` (gatilhos: novo item, agente online,
 * elegibilidade, capacidade liberada, botão manual, cron de segurança).
 * A drenagem é **por departamento**: quem fica elegível só abre a fila
 * dos seus depts (FIFO + capacidade livre); outros depts permanecem na espera.
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
 * Critério da fila = atendimentos ABERTOS SEM responsável (`assignedToId=null`)
 * em que o contato JÁ RESPONDEU pelo menos uma vez (`lastInboundAt` preenchido).
 *
 * Calouros que só receberam template "BV / Bem-vindo" e nunca responderam
 * NÃO entram na fila de espera nem na drenagem — só passam a contar quando
 * houver inbound real do aluno.
 *
 * NÃO usamos `hasAgentReply` de propósito: uma resposta de AUTOMAÇÃO/IA marca
 * `hasAgentReply=true` e tiraria o lead da aba "Entrada", mas ele continua SEM
 * responsável humano e PRECISA ser distribuído (desde que já tenha inbound).
 */
export const ABERTA_SEM_RESPONSAVEL: Prisma.ConversationWhereInput = {
  status: "OPEN",
  assignedToId: null,
  lastInboundAt: { not: null },
};

export async function getPendingDistributions(): Promise<
  PendingDistributionView[]
> {
  // Limpa pendências de quem só recebeu template e nunca respondeu.
  await purgeUnansweredFromPendingQueue().catch(() => 0);

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

/** Teto de segurança por consultor por passagem quando queueLimit=0 (sem limite configurado). */
const SAFETY_CAP_PER_USER = 25;

/** Debounce / lock in-memory por org (sem schema novo). */
const drainState = new Map<
  string,
  {
    running: boolean;
    queuedTrigger: PendingQueueTrigger | null;
    /** null = todos os depts com elegível; string = só depts desta pessoa. */
    queuedUserId: string | null;
    timer: ReturnType<typeof setTimeout> | null;
  }
>();

function getDrainState(orgId: string) {
  let s = drainState.get(orgId);
  if (!s) {
    s = {
      running: false,
      queuedTrigger: null,
      queuedUserId: null,
      timer: null,
    };
    drainState.set(orgId, s);
  }
  return s;
}

type ResponsibleCapacity = {
  userId: string;
  queueLimit: number;
  queueCount: number;
  departments: { id: string }[];
};

/** Capacidade livre ao vivo de um consultor, descontando atribuições desta passagem. */
function liveFreeCapacityForUser(
  r: Pick<ResponsibleCapacity, "userId" | "queueLimit" | "queueCount">,
  assignedDeltaByUser: Map<string, number>,
): number {
  const delta = assignedDeltaByUser.get(r.userId) ?? 0;
  const loaded = r.queueCount + delta;
  // Sem limite configurado: ainda assim não ultrapassa o teto de segurança
  // por consultor (conta carga atual + o que já entrou nesta passagem).
  const cap = r.queueLimit > 0 ? r.queueLimit : SAFETY_CAP_PER_USER;
  return Math.max(0, cap - loaded);
}

function eligibleInDeptScope(
  eligible: ResponsibleCapacity[],
  deptId: string | null,
): ResponsibleCapacity[] {
  return eligible.filter((r) =>
    deptId === null
      ? true
      : r.departments.some((d) => d.id === deptId),
  );
}

/**
 * Capacidade livre agregada dos elegíveis de um departamento
 * (ou org-wide quando deptId é null), com delta desta passagem.
 */
function takeLimitForDept(
  eligible: ResponsibleCapacity[],
  deptId: string | null,
  assignedDeltaByUser: Map<string, number>,
): number {
  const inScope = eligibleInDeptScope(eligible, deptId);
  if (inScope.length === 0) return 0;
  return inScope.reduce(
    (acc, r) => acc + liveFreeCapacityForUser(r, assignedDeltaByUser),
    0,
  );
}

function hasRemainingCapacityInScope(
  eligible: ResponsibleCapacity[],
  deptId: string | null,
  assignedDeltaByUser: Map<string, number>,
): boolean {
  return eligibleInDeptScope(eligible, deptId).some(
    (r) => liveFreeCapacityForUser(r, assignedDeltaByUser) > 0,
  );
}

/**
 * Marca como RESOLVED as pendências cuja conversa NÃO precisa mais ser
 * distribuída — ou seja, saiu do universo `ABERTA_SEM_RESPONSAVEL`. Cobre:
 *
 *   - Conversa encerrada por qualquer via (status != OPEN)
 *   - Conversa OPEN mas já atribuída por outro caminho (agente manual,
 *     herança de contato/deal, `maybeAssignExisting…`)
 *   - Conversa deletada
 *   - Conversa sem nenhuma mensagem inbound do aluno (só template BV / outbound)
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
      ...ABERTA_SEM_RESPONSAVEL,
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
 * Remove da fila de espera (lista + DistributionPending) conversas OPEN sem
 * responsável em que o aluno nunca respondeu — tipicamente calouros que só
 * receberam template de bem-vindo. Chamada no GET da fila para limpar o
 * dashboard imediatamente, sem depender do cron de drenagem.
 */
export async function purgeUnansweredFromPendingQueue(): Promise<number> {
  const orgId = getOrgIdOrNull();
  if (!orgId) return 0;

  const unanswered = await prisma.conversation.findMany({
    where: {
      status: "OPEN",
      assignedToId: null,
      lastInboundAt: null,
    },
    select: { id: true, contactId: true },
    take: 2000,
  });
  if (unanswered.length === 0) return 0;

  const convIds = unanswered.map((c) => c.id);
  const contactIds = unanswered
    .map((c) => c.contactId)
    .filter((id): id is string => Boolean(id));

  const res = await prisma.distributionPending.updateMany({
    where: {
      organizationId: orgId,
      status: "PENDING",
      OR: [
        { conversationId: { in: convIds } },
        ...(contactIds.length > 0
          ? [{ contactId: { in: contactIds }, conversationId: null }]
          : []),
      ],
    },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
    },
  });

  if (res.count > 0) {
    console.info(
      "[distribution] purgeUnansweredFromPendingQueue",
      JSON.stringify({ orgId, conversations: unanswered.length, resolved: res.count }),
    );
  }
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
 *
 * Regra: drena **por departamento** — nunca mistura filas de depts diferentes
 * num lote global. Com `userId` (agent_online / agent_eligible), só os depts
 * dessa pessoa; sem `userId` (cron / manual / capacity), todos os depts que
 * tenham pelo menos 1 humano elegível agora.
 *
 * Dentro de cada dept: FIFO (mais antigos primeiro) com teto = capacidade
 * livre agregada dos elegíveis daquele dept. Capacidade é **global por
 * consultor** (não multiplica por dept); atribuições desta passagem entram
 * no delta antes de abrir o próximo bucket.
 */
export async function processPendingDistributionQueue(opts: {
  trigger: PendingQueueTrigger;
  /** Quando informado, restringe a drenagem aos departamentos desta pessoa. */
  userId?: string | null;
}): Promise<RetryResult> {
  const orgId = getOrgIdOrNull();
  if (!orgId) {
    return { resolved: 0, cancelled: 0, pending: 0, trigger: opts.trigger };
  }

  const state = getDrainState(orgId);
  if (state.running) {
    // Coalesca: marca para re-rodar ao terminar.
    // 2º evento enquanto roda → amplia (todos os depts com elegível),
    // para não perder o dept de outro consultor que ficou elegível.
    if (state.queuedTrigger) {
      state.queuedUserId = null;
    } else {
      state.queuedUserId = opts.userId ?? null;
    }
    state.queuedTrigger = opts.trigger;
    const pending = await prisma.conversation.count({
      where: ABERTA_SEM_RESPONSAVEL,
    });
    return { resolved: 0, cancelled: 0, pending, trigger: opts.trigger };
  }

  state.running = true;
  try {
    const widgetActive = await hasOrganizationWidget("smart_distribution");
    console.warn(
      "[DBG-e46688 retry] widget check",
      JSON.stringify({
        widgetActive,
        trigger: opts.trigger,
        userId: opts.userId ?? null,
      }),
    );
    if (!widgetActive) {
      return { resolved: 0, cancelled: 0, pending: 0, trigger: opts.trigger };
    }

    let cancelledOrphans = 0;
    try {
      cancelledOrphans = await cancelStalePendingOrphans(orgId);
      if (cancelledOrphans > 0) {
        console.info(
          "[distribution] cancelStalePendingOrphans",
          JSON.stringify({
            orgId,
            trigger: opts.trigger,
            cancelled: cancelledOrphans,
          }),
        );
      }
    } catch (e) {
      console.warn("[distribution] cancelStalePendingOrphans failed", e);
    }

    let views: Awaited<ReturnType<typeof getDistributionResponsibles>> = [];
    try {
      views = await getDistributionResponsibles();
    } catch (e) {
      console.warn(
        "[distribution] processPending eligibility precheck failed",
        e,
      );
    }
    const eligible = views.filter((r) => r.eligible);

    if (eligible.length === 0) {
      const pending = await prisma.conversation.count({
        where: ABERTA_SEM_RESPONSAVEL,
      });
      console.info(
        "[distribution] processPending skip — nenhum consultor elegível",
        JSON.stringify({
          orgId,
          trigger: opts.trigger,
          pending,
          cancelledOrphans,
        }),
      );
      return {
        resolved: 0,
        cancelled: cancelledOrphans,
        pending,
        trigger: opts.trigger,
      };
    }

    // Depts a drenar nesta passagem.
    let targetDeptIds: string[] = [];
    let includeOrgWide = false;

    if (opts.userId) {
      const focus = views.find((r) => r.userId === opts.userId);
      if (!focus?.eligible) {
        const pending = await prisma.conversation.count({
          where: ABERTA_SEM_RESPONSAVEL,
        });
        console.info(
          "[distribution] processPending skip — userId não elegível",
          JSON.stringify({
            orgId,
            trigger: opts.trigger,
            userId: opts.userId,
            pending,
          }),
        );
        return {
          resolved: 0,
          cancelled: cancelledOrphans,
          pending,
          trigger: opts.trigger,
        };
      }
      targetDeptIds = focus.departments.map((d) => d.id);
      // Sem dept: pode receber leads org-wide (sem departmentId na conversa).
      includeOrgWide = targetDeptIds.length === 0;
      // Com dept(s): também tenta org-wide (pool humano elegível inclui esta pessoa).
      if (targetDeptIds.length > 0) includeOrgWide = true;
    } else {
      const deptSet = new Set<string>();
      for (const r of eligible) {
        for (const d of r.departments) deptSet.add(d.id);
      }
      targetDeptIds = Array.from(deptSet);
      includeOrgWide = true;
    }

    let resolved = 0;
    let scanned = 0;
    /** Atribuições bem-sucedidas nesta passagem, por consultor (capacidade global). */
    const assignedDeltaByUser = new Map<string, number>();

    const drainBucket = async (departmentId: string | null) => {
      if (
        !hasRemainingCapacityInScope(
          eligible,
          departmentId,
          assignedDeltaByUser,
        )
      ) {
        return;
      }

      let take = takeLimitForDept(
        eligible,
        departmentId,
        assignedDeltaByUser,
      );

      if (take <= 0) return;

      const items = await prisma.conversation.findMany({
        where: {
          ...ABERTA_SEM_RESPONSAVEL,
          departmentId: departmentId === null ? null : departmentId,
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, contactId: true, departmentId: true },
        take,
      });
      scanned += items.length;

      for (const it of items) {
        if (
          !hasRemainingCapacityInScope(
            eligible,
            departmentId,
            assignedDeltaByUser,
          )
        ) {
          console.info(
            "[distribution] processPending cap — scope capacity exhausted",
            JSON.stringify({
              orgId,
              trigger: opts.trigger,
              userId: opts.userId ?? null,
              departmentId,
              assignedDeltaByUser: Object.fromEntries(assignedDeltaByUser),
            }),
          );
          break;
        }

        try {
          const result = await executeDistribution({
            dealId: null,
            contactId: it.contactId,
            conversationId: it.id,
            distributionType: null,
            triggerSource: "SYSTEM",
            departmentId: it.departmentId,
            allowOrgWideFallback: false,
          });
          console.warn(
            "[DBG-e46688 retry] executeDistribution",
            JSON.stringify({
              convId: it.id,
              departmentId: it.departmentId,
              success: result.success,
              reason: result.reason,
              selectedUserId: result.selectedUserId,
            }),
          );
          if (result.success) {
            resolved++;
            if (result.selectedUserId) {
              const uid = result.selectedUserId;
              assignedDeltaByUser.set(
                uid,
                (assignedDeltaByUser.get(uid) ?? 0) + 1,
              );

              if (opts.userId && uid === opts.userId) {
                const focus = eligible.find((r) => r.userId === opts.userId);
                if (
                  focus &&
                  liveFreeCapacityForUser(focus, assignedDeltaByUser) <= 0
                ) {
                  console.info(
                    "[distribution] processPending cap — user budget exhausted",
                    JSON.stringify({
                      orgId,
                      trigger: opts.trigger,
                      userId: opts.userId,
                      departmentId,
                      assignedInPass: assignedDeltaByUser.get(opts.userId) ?? 0,
                    }),
                  );
                }
              }
            }
          } else if (
            result.reason === "NO_ELIGIBLE_RESPONSIBLE" ||
            result.reason === "NO_DEPARTMENT"
          ) {
            // Capacidade do dept esgotou nesta passagem — para o bucket.
            break;
          }
        } catch (e) {
          console.error(
            "[distribution] processPendingDistributionQueue item failed",
            {
              conversationId: it.id,
              trigger: opts.trigger,
              err: e,
            },
          );
        }
      }
    };

    for (const deptId of targetDeptIds) {
      await drainBucket(deptId);
    }
    if (includeOrgWide) {
      await drainBucket(null);
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
          userId: opts.userId ?? null,
          targetDeptIds,
          includeOrgWide,
          resolved,
          cancelledOrphans,
          pending,
          scanned,
        }),
      );
    }

    return {
      resolved,
      cancelled: cancelledOrphans,
      pending,
      trigger: opts.trigger,
    };
  } finally {
    state.running = false;
    const queued = state.queuedTrigger;
    const queuedUserId = state.queuedUserId;
    state.queuedTrigger = null;
    state.queuedUserId = null;
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
        userId: queuedUserId,
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
  /** Restringe aos depts desta pessoa (agent_online / agent_eligible). */
  userId?: string | null;
}): void {
  const orgId = getOrgIdOrNull();
  if (!orgId) return;

  const delayMs = opts.delayMs ?? 500;
  const state = getDrainState(orgId);
  // Debounce por org: vários gatilhos próximos viram uma única execução.
  state.queuedTrigger = opts.trigger;
  if (
    opts.userId &&
    state.queuedUserId &&
    opts.userId !== state.queuedUserId
  ) {
    state.queuedUserId = null;
  } else if (!opts.userId) {
    state.queuedUserId = null;
  } else if (!state.timer) {
    state.queuedUserId = opts.userId;
  } else if (state.queuedUserId === opts.userId) {
    state.queuedUserId = opts.userId;
  }
  // Se já havia timer com outro escopo amplo (null), mantém amplo.

  if (state.timer) {
    clearTimeout(state.timer);
  }

  state.timer = setTimeout(() => {
    state.timer = null;
    const trigger = state.queuedTrigger ?? opts.trigger;
    const userId = state.queuedUserId;
    state.queuedTrigger = null;
    state.queuedUserId = null;

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
      () => processPendingDistributionQueue({ trigger, userId }),
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
