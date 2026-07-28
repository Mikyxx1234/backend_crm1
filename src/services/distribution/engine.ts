/**
 * Motor único da Distribuição Inteligente.
 *
 * Compartilhado por: distribuição real (`auto-deals.ts`, na Fase 6), ação de
 * automação (`execute_distribution`, Fase 5), execução manual e a tela
 * ("Testar distribuição"). A elegibilidade vem de `eligibility.ts` e a fila
 * de `queue.ts`, garantindo que tela, simulação e execução decidam igual.
 *
 * Seleção (v1): elegíveis → menor fila → desempate por `lastExecutionAt` mais
 * antigo (nunca executado tem prioridade). `volume` é apenas peso exibido na
 * v2, não entra na seleção v1.
 */

import { Prisma } from "@prisma/client";

import { getOrgSettingBool } from "@/lib/org-settings";
import { prisma } from "@/lib/prisma";
import { getOrgIdOrThrow } from "@/lib/request-context";
import { logEvent } from "@/services/activity-log";
import {
  assignDealOwner,
  propagateOwnerToContactAndChat,
  syncOwnershipForContact,
} from "@/services/deals";
import { hasOrganizationWidget } from "@/services/organization-widgets";

import type { DistributionBlockReason } from "./eligibility";
import {
  getDistributionResponsibles,
  type DistributionResponsibleView,
} from "./responsibles";

export type DistributionTriggerSource =
  | "SYSTEM"
  | "AUTOMATION"
  | "MANUAL"
  | "SIMULATION";

export type DistributionReason =
  | "ASSIGNED"
  | "SMART_DISTRIBUTION_NOT_ENABLED"
  | "NO_ELIGIBLE_RESPONSIBLE"
  | "NO_DEPARTMENT";

export interface ExecuteDistributionInput {
  dealId?: string | null;
  contactId?: string | null;
  conversationId?: string | null;
  triggerSource: DistributionTriggerSource;
  /** Tipo/segmento solicitado (avalia `TYPE_INCOMPATIBLE`). */
  distributionType?: string | null;
  /**
   * Departamento-alvo explícito (opcional). Quando não vier, o motor resolve
   * pelo departamento da conversa (`Conversation.departmentId`, definido por
   * automações de transferência).
   */
  departmentId?: string | null;
  /**
   * Pool explícito de departamentos (automação `execute_distribution`).
   * Quando preenchido, ignora o toggle org `respectDepartment` e distribui
   * apenas entre membros de qualquer um desses departamentos.
   */
  departmentIds?: string[] | null;
  /**
   * Quando true, redistribui mesmo se a conversa já tiver responsável
   * (uso manual no inbox / handoff entre departamentos).
   */
  reassign?: boolean;
  /** Momento de referência (testes). Default: agora. */
  now?: Date;
}

/**
 * Escopo resolvido para uma distribuição:
 *  - `org-wide`: nenhum departamento da org opta por distribuição automática
 *    (feature não adotada) → comportamento clássico (todos os elegíveis).
 *  - `department`: o lead foi roteado a um departamento COM `distributionEnabled`
 *    → só membros desse departamento entram na disputa.
 *  - `blocked`: a org usa o recurso, mas este lead não está em um departamento
 *    habilitado (ou não tem departamento) → não distribui, vai pra fila.
 */
type DepartmentScope =
  | { mode: "org-wide"; departmentId: null }
  | { mode: "department"; departmentId: string }
  | { mode: "blocked"; departmentId: string | null };

/**
 * Resolve o escopo de departamento. A distribuição por departamento é POR
 * DEPARTAMENTO (`Department.distributionEnabled`), não um toggle global: cada
 * departamento decide se usa distribuição automática entre seus membros. Se
 * NENHUM departamento da org habilitou, mantém o comportamento org-wide
 * (retrocompatível). A regra individual de cada responsável continua valendo.
 */
async function resolveDepartmentScope(
  input: Pick<ExecuteDistributionInput, "conversationId" | "departmentId">,
): Promise<DepartmentScope> {
  // Opção da org (default DESLIGADO): só respeita o departamento da conversa
  // quando ligado. Desligado = distribuição CLÁSSICA org-wide (todos os
  // elegíveis), ignorando departamento — evita que conversas sem roteamento
  // fiquem presas na fila. Ligue quando existirem regras claras de roteamento.
  const respectDepartment = await getOrgSettingBool(
    "distribution.respectDepartment",
    false,
  );
  if (!respectDepartment) return { mode: "org-wide", departmentId: null };

  // Feature em uso? Só quando ao menos 1 departamento opta por distribuição.
  const enabledCount = await prisma.department.count({
    where: { distributionEnabled: true },
  });
  if (enabledCount === 0) return { mode: "org-wide", departmentId: null };

  // Resolve o departamento-alvo: explícito > conversa.
  let departmentId = input.departmentId ?? null;
  if (!departmentId && input.conversationId) {
    const conv = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { departmentId: true },
    });
    departmentId = conv?.departmentId ?? null;
  }
  // Conversa SEM departamento identificado → distribui para todos os elegíveis
  // (comportamento clássico), em vez de bloquear na fila.
  if (!departmentId) return { mode: "org-wide", departmentId: null };

  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { distributionEnabled: true },
  });
  if (dept?.distributionEnabled) return { mode: "department", departmentId };
  // Departamento identificado mas que optou por NÃO distribuir automaticamente
  // → respeita o opt-out: fica na fila (manual).
  return { mode: "blocked", departmentId };
}

/** Diagnóstico compacto de um responsável (vai para o log e a resposta). */
export interface EvaluatedResponsibleSummary {
  userId: string;
  name: string | null;
  eligible: boolean;
  blockedReasons: DistributionBlockReason[];
  queueCount: number;
}

export interface DistributionResult {
  success: boolean;
  reason: DistributionReason;
  selectedUserId: string | null;
  selectedUserName: string | null;
  evaluated: EvaluatedResponsibleSummary[];
}

function toSummary(
  responsibles: DistributionResponsibleView[],
): EvaluatedResponsibleSummary[] {
  return responsibles.map((r) => ({
    userId: r.userId,
    name: r.name,
    eligible: r.eligible,
    blockedReasons: r.blockedReasons,
    queueCount: r.queueCount,
  }));
}

/**
 * Seleciona o responsável: menor fila; empate → `lastExecutionAt` mais antigo
 * (nunca executado = prioridade máxima). Assume lista já filtrada por elegíveis
 * e não vazia.
 */
export function selectResponsible(
  eligible: DistributionResponsibleView[],
): DistributionResponsibleView {
  return [...eligible].sort((a, b) => {
    if (a.queueCount !== b.queueCount) return a.queueCount - b.queueCount;
    const aTime = a.lastExecutionAt ? Date.parse(a.lastExecutionAt) : 0;
    const bTime = b.lastExecutionAt ? Date.parse(b.lastExecutionAt) : 0;
    return aTime - bTime;
  })[0];
}

/**
 * Enfileira um lead na fila de espera (DistributionPending) quando nenhum
 * responsável estava elegível. Idempotente: se já existe um PENDING para o
 * mesmo deal/contato, apenas incrementa `attempts`/`lastAttemptAt`.
 */
async function enqueuePending(input: ExecuteDistributionInput): Promise<void> {
  if (!input.dealId && !input.contactId) return;
  try {
    const existing = await prisma.distributionPending.findFirst({
      where: {
        status: "PENDING",
        ...(input.dealId
          ? { dealId: input.dealId }
          : { contactId: input.contactId }),
      },
      select: { id: true, attempts: true },
    });
    if (existing) {
      await prisma.distributionPending.update({
        where: { id: existing.id },
        data: {
          attempts: existing.attempts + 1,
          lastAttemptAt: new Date(),
          ...(input.conversationId
            ? { conversationId: input.conversationId }
            : {}),
        },
      });
    } else {
      await prisma.distributionPending.create({
        data: {
          organizationId: getOrgIdOrThrow(),
          dealId: input.dealId ?? null,
          contactId: input.contactId ?? null,
          conversationId: input.conversationId ?? null,
          distributionType: input.distributionType ?? null,
          triggerSource: input.triggerSource,
          status: "PENDING",
          attempts: 1,
          lastAttemptAt: new Date(),
        },
      });
    }
    // A UI da fila deriva de conversas OPEN sem assignee — agenda drenagem
    // (import dinâmico evita ciclo engine ↔ pending). Útil em corrida com
    // presença/horário: alguém fica elegível milissegundos depois.
    void import("./pending")
      .then((m) =>
        m.scheduleProcessPendingDistributionQueue({
          trigger: "new_item",
          delayMs: 2000,
        }),
      )
      .catch(() => {});
  } catch (e) {
    console.error("[distribution] falha ao enfileirar pendência", e);
  }
}

/** Marca como RESOLVED qualquer pendência aberta do mesmo lead. */
async function resolvePendingFor(
  dealId: string | null | undefined,
  contactId: string | null | undefined,
  userId: string,
): Promise<void> {
  if (!dealId && !contactId) return;
  try {
    await prisma.distributionPending.updateMany({
      where: {
        status: "PENDING",
        ...(dealId ? { dealId } : { contactId }),
      },
      data: { status: "RESOLVED", resolvedUserId: userId, resolvedAt: new Date() },
    });
  } catch (e) {
    console.error("[distribution] falha ao resolver pendência", e);
  }
}

/**
 * Grava um evento no feed de atividades (/logs do CRM) para a distribuição.
 * Observabilidade — nunca derruba a distribuição se falhar.
 */
async function emitDistributionEvent(
  input: ExecuteDistributionInput,
  success: boolean,
  reason: DistributionReason,
  selectedUserId: string | null,
  selectedUserName: string | null,
  assignedDealId: string | null,
): Promise<void> {
  const entityId =
    assignedDealId ?? input.contactId ?? input.conversationId ?? null;
  if (!entityId) return;
  try {
    await logEvent({
      type: success ? "LEAD_DISTRIBUTED" : "LEAD_DISTRIBUTION_FAILED",
      entityType: assignedDealId ? "DEAL" : "CONTACT",
      entityId,
      entityLabel: selectedUserName ?? null,
      dealId: assignedDealId,
      contactId: input.contactId ?? null,
      conversationId: input.conversationId ?? null,
      field: "owner",
      newValue: selectedUserName ?? null,
      meta: { reason, triggerSource: input.triggerSource, selectedUserId },
      actor: {
        type: input.triggerSource === "AUTOMATION" ? "AUTOMATION" : "SYSTEM",
        label: "Distribuição Inteligente",
      },
    });
  } catch (e) {
    console.error("[distribution] falha ao gravar evento no feed", e);
  }
}

/** Janela para juntar retries do mesmo lead (automação + drenagem SYSTEM). */
const LOG_COALESCE_WINDOW_MS = 45_000;

const TRIGGER_MERGE_ORDER: DistributionTriggerSource[] = [
  "AUTOMATION",
  "MANUAL",
  "SYSTEM",
  "SIMULATION",
];

function mergeTriggerSources(
  existing: string,
  next: DistributionTriggerSource,
): string {
  const parts = new Set(
    existing
      .split("+")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  parts.add(next);
  const ordered = TRIGGER_MERGE_ORDER.filter((t) => parts.has(t));
  for (const t of parts) {
    if (!ordered.includes(t as DistributionTriggerSource)) ordered.push(t);
  }
  return ordered.join("+");
}

async function writeLog(
  input: ExecuteDistributionInput,
  success: boolean,
  reason: DistributionReason,
  selectedUserId: string | null,
  evaluated: EvaluatedResponsibleSummary[],
): Promise<void> {
  try {
    const orgId = getOrgIdOrThrow();
    const since = new Date(Date.now() - LOG_COALESCE_WINDOW_MS);

    // Mesmo atendimento/contato/deal + mesmo resultado em janela curta →
    // atualiza o log existente (junta AUTOMATION+SYSTEM) em vez de duplicar.
    const identity: Prisma.DistributionLogWhereInput | null =
      input.conversationId
        ? { conversationId: input.conversationId }
        : input.contactId
          ? { contactId: input.contactId }
          : input.dealId
            ? { dealId: input.dealId }
            : null;

    if (identity) {
      const recent = await prisma.distributionLog.findFirst({
        where: {
          ...identity,
          success,
          reason,
          createdAt: { gte: since },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, triggerSource: true },
      });
      if (recent) {
        await prisma.distributionLog.update({
          where: { id: recent.id },
          data: {
            triggerSource: mergeTriggerSources(
              recent.triggerSource,
              input.triggerSource,
            ),
            selectedUserId,
            dealId: input.dealId ?? undefined,
            contactId: input.contactId ?? undefined,
            conversationId: input.conversationId ?? undefined,
            evaluated: evaluated as unknown as Prisma.InputJsonValue,
          },
        });
        return;
      }
    }

    await prisma.distributionLog.create({
      data: {
        organizationId: orgId,
        triggerSource: input.triggerSource,
        dealId: input.dealId ?? null,
        contactId: input.contactId ?? null,
        conversationId: input.conversationId ?? null,
        selectedUserId,
        success,
        reason,
        evaluated: evaluated as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    // Log é observabilidade — nunca deve derrubar a distribuição.
    console.error("[distribution] falha ao gravar DistributionLog", e);
  }
}

/**
 * Distribuição REAL: avalia, seleciona, ATRIBUI o owner (propagando para
 * contato/conversa), atualiza `lastExecutionAt` e grava `DistributionLog`.
 * Deve rodar dentro de `withOrgContext` / contexto org-scoped.
 */
export async function executeDistribution(
  input: ExecuteDistributionInput,
): Promise<DistributionResult> {
  if (!(await hasOrganizationWidget("smart_distribution"))) {
    return {
      success: false,
      reason: "SMART_DISTRIBUTION_NOT_ENABLED",
      selectedUserId: null,
      selectedUserName: null,
      evaluated: [],
    };
  }

  // Idempotente: se a conversa já tem responsável (ex.: inbound acabou de
  // distribuir e a automação dispara execute_distribution de novo), não
  // reatribui — salvo `reassign` (handoff manual para departamento).
  // Antes de sair, cura deal/contato sem owner (pipeline "Sem responsável").
  if (input.conversationId && !input.reassign) {
    const already = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { assignedToId: true, contactId: true },
    });
    if (already?.assignedToId) {
      const contactId = input.contactId ?? already.contactId ?? null;
      if (contactId) {
        await syncOwnershipForContact(contactId);
      } else if (input.dealId) {
        const deal = await prisma.deal.findUnique({
          where: { id: input.dealId },
          select: { ownerId: true, contactId: true },
        });
        if (deal && !deal.ownerId) {
          await assignDealOwner(input.dealId, already.assignedToId);
        } else if (deal?.contactId) {
          await syncOwnershipForContact(deal.contactId);
        }
      }
      await resolvePendingFor(
        input.dealId,
        contactId,
        already.assignedToId,
      );
      return {
        success: true,
        reason: "ASSIGNED",
        selectedUserId: already.assignedToId,
        selectedUserName: null,
        evaluated: [],
      };
    }
  }

  // Conversa sem assignee mas deal/contato já tem dono → espelha pro chat
  // antes de tentar redistribuir (evita "já tem owner no pipeline" + inbox vazio).
  if (!input.reassign) {
    const contactId =
      input.contactId ??
      (input.conversationId
        ? (
            await prisma.conversation.findUnique({
              where: { id: input.conversationId },
              select: { contactId: true },
            })
          )?.contactId
        : null) ??
      (input.dealId
        ? (
            await prisma.deal.findUnique({
              where: { id: input.dealId },
              select: { contactId: true },
            })
          )?.contactId
        : null);
    if (contactId) {
      const healed = await syncOwnershipForContact(contactId);
      if (healed && input.conversationId) {
        const again = await prisma.conversation.findUnique({
          where: { id: input.conversationId },
          select: { assignedToId: true },
        });
        if (again?.assignedToId) {
          await resolvePendingFor(input.dealId, contactId, again.assignedToId);
          return {
            success: true,
            reason: "ASSIGNED",
            selectedUserId: again.assignedToId,
            selectedUserName: null,
            evaluated: [],
          };
        }
      }
    }
  }

  // Handoff: libera o responsável atual antes de redistribuir — se ninguém
  // estiver elegível, o lead fica na fila de espera (sem dono antigo).
  if (input.reassign && input.conversationId) {
    const conv = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { assignedToId: true, contactId: true },
    });
    if (conv?.assignedToId) {
      const contactId = conv.contactId ?? input.contactId ?? null;
      await prisma.$transaction(async (tx) => {
        await tx.conversation.update({
          where: { id: input.conversationId! },
          data: { assignedToId: null },
        });
        if (contactId) {
          await tx.contact.update({
            where: { id: contactId },
            data: { assignedToId: null },
          });
          await tx.deal.updateMany({
            where: { contactId, status: "OPEN" },
            data: { ownerId: null },
          });
        }
      });
    }
  }

  // Pool explícito da automação (1+ departamentos no card) — força escopo
  // mesmo com respectDepartment=false na org.
  const explicitDeptIds = Array.from(
    new Set(
      [
        ...(input.departmentIds ?? []),
        ...(input.departmentId ? [input.departmentId] : []),
      ].filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  let responsibles;
  if (explicitDeptIds.length > 0) {
    // Marca a conversa com o 1º departamento (contexto/inbox); o pool
    // de elegíveis usa TODOS os IDs selecionados.
    if (input.conversationId) {
      await prisma.conversation.update({
        where: { id: input.conversationId },
        data: { departmentId: explicitDeptIds[0]! },
      });
    }
    responsibles = await getDistributionResponsibles({
      distributionType: input.distributionType ?? null,
      now: input.now,
      departmentIds: explicitDeptIds,
    });
  } else {
    // Distribuição por departamento (flag por depto). A org usa o recurso mas
    // este lead não está num departamento habilitado (ou sem departamento) →
    // não distribui (fallback = fila), respeitando a fronteira do departamento.
    const deptScope = await resolveDepartmentScope(input);
    if (deptScope.mode === "blocked") {
      await writeLog(input, false, "NO_DEPARTMENT", null, []);
      await enqueuePending(input);
      await emitDistributionEvent(input, false, "NO_DEPARTMENT", null, null, null);
      return {
        success: false,
        reason: "NO_DEPARTMENT",
        selectedUserId: null,
        selectedUserName: null,
        evaluated: [],
      };
    }

    responsibles = await getDistributionResponsibles({
      distributionType: input.distributionType ?? null,
      now: input.now,
      departmentId: deptScope.mode === "department" ? deptScope.departmentId : null,
    });
  }
  const evaluated = toSummary(responsibles);
  const eligible = responsibles.filter((r) => r.eligible);

  if (eligible.length === 0) {
    // Ninguém elegível: não força atribuição. Registra no log E enfileira o
    // lead na fila de espera, para redistribuir quando alguém ficar ONLINE.
    await writeLog(input, false, "NO_ELIGIBLE_RESPONSIBLE", null, evaluated);
    await enqueuePending(input);
    await emitDistributionEvent(
      input,
      false,
      "NO_ELIGIBLE_RESPONSIBLE",
      null,
      null,
      null,
    );
    return {
      success: false,
      reason: "NO_ELIGIBLE_RESPONSIBLE",
      selectedUserId: null,
      selectedUserName: null,
      evaluated,
    };
  }

  const selected = selectResponsible(eligible);

  // Atribui o owner. Quando veio um dealId explícito, usa-o. Quando veio só
  // contactId (ex.: automação manual disparada pela conversa), resolvemos o
  // negócio ABERTO do contato e atribuímos TAMBÉM o deal — senão o lead
  // aparece "Sem responsável" no pipeline. assignDealOwner já propaga para
  // contato e conversas; sem deal aberto, propagamos direto.
  let assignedDealId: string | null = input.dealId ?? null;
  if (input.dealId) {
    await assignDealOwner(input.dealId, selected.userId);
  } else if (input.contactId) {
    const contactId = input.contactId;
    const openDeal = await prisma.deal.findFirst({
      where: { contactId, status: "OPEN" },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (openDeal) {
      assignedDealId = openDeal.id;
      await assignDealOwner(openDeal.id, selected.userId);
    } else {
      await prisma.$transaction((tx) =>
        propagateOwnerToContactAndChat(tx, contactId, selected.userId),
      );
    }
  }

  const orgId = getOrgIdOrThrow();
  await prisma.distributionResponsible.upsert({
    where: {
      organizationId_userId: { organizationId: orgId, userId: selected.userId },
    },
    update: { lastExecutionAt: new Date() },
    create: {
      organizationId: orgId,
      userId: selected.userId,
      lastExecutionAt: new Date(),
    },
  });

  await resolvePendingFor(input.dealId, input.contactId, selected.userId);
  await writeLog(input, true, "ASSIGNED", selected.userId, evaluated);
  await emitDistributionEvent(
    input,
    true,
    "ASSIGNED",
    selected.userId,
    selected.name,
    assignedDealId,
  );

  return {
    success: true,
    reason: "ASSIGNED",
    selectedUserId: selected.userId,
    selectedUserName: selected.name,
    evaluated,
  };
}

/**
 * Simulação ("Testar distribuição"): faz a MESMA avaliação/seleção, mas NÃO
 * atribui, NÃO atualiza `lastExecutionAt` e NÃO grava log. Retorna o
 * diagnóstico completo + a escolha prevista.
 */
export async function simulateDistribution(
  input: Omit<ExecuteDistributionInput, "triggerSource">,
): Promise<DistributionResult> {
  if (!(await hasOrganizationWidget("smart_distribution"))) {
    return {
      success: false,
      reason: "SMART_DISTRIBUTION_NOT_ENABLED",
      selectedUserId: null,
      selectedUserName: null,
      evaluated: [],
    };
  }

  // Simulação: escopa ao departamento apenas quando resolvido para um depto
  // habilitado; caso contrário simula org-wide (o "testar" genérico não tem
  // lead atrelado, então não bloqueia).
  const deptScope = await resolveDepartmentScope(input);

  const responsibles = await getDistributionResponsibles({
    distributionType: input.distributionType ?? null,
    now: input.now,
    departmentId: deptScope.mode === "department" ? deptScope.departmentId : null,
  });
  const evaluated = toSummary(responsibles);
  const eligible = responsibles.filter((r) => r.eligible);

  if (eligible.length === 0) {
    return {
      success: false,
      reason: "NO_ELIGIBLE_RESPONSIBLE",
      selectedUserId: null,
      selectedUserName: null,
      evaluated,
    };
  }

  const selected = selectResponsible(eligible);
  return {
    success: true,
    reason: "ASSIGNED",
    selectedUserId: selected.userId,
    selectedUserName: selected.name,
    evaluated,
  };
}
