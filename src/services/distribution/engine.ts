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

import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { getOrgIdOrThrow, getOrgIdOrNull } from "@/lib/request-context";
import { sseBus } from "@/lib/sse-bus";
import { logEvent } from "@/services/activity-log";
import {
  assignDealOwner,
  propagateOwnerToContactAndChat,
} from "@/services/deals";
import { hasOrganizationWidget } from "@/services/organization-widgets";

import type { DistributionBlockReason } from "./eligibility";
import {
  getDistributionResponsibles,
  type DistributionResponsibleView,
} from "./responsibles";
import { getDistributionSettings } from "./settings";

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
   * Departamento-alvo explícito (opcional). Quando a distribuição por
   * departamento está ligada e não vier explícito, o motor resolve pelo
   * departamento da conversa (`Conversation.departmentId`).
   */
  departmentId?: string | null;
  /** Momento de referência (testes). Default: agora. */
  now?: Date;
}

/**
 * Resolve o escopo de departamento para uma distribuição. Retorna se o modo
 * (toggle org `distributeByDepartment`) está ligado e qual departamento
 * aplicar (explícito > conversa). `departmentId` null com `enabled=true`
 * significa "modo ligado mas sem departamento resolvível".
 */
async function resolveDepartmentScope(
  input: Pick<ExecuteDistributionInput, "conversationId" | "departmentId">,
): Promise<{ enabled: boolean; departmentId: string | null }> {
  const { distributeByDepartment } = await getDistributionSettings();
  if (!distributeByDepartment) return { enabled: false, departmentId: null };
  if (input.departmentId) return { enabled: true, departmentId: input.departmentId };
  if (input.conversationId) {
    const conv = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { departmentId: true },
    });
    return { enabled: true, departmentId: conv?.departmentId ?? null };
  }
  return { enabled: true, departmentId: null };
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
        data: { attempts: existing.attempts + 1, lastAttemptAt: new Date() },
      });
      return;
    }
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
 * Posta uma NOTA INTERNA na conversa (visível no inbox/pipeline, NUNCA
 * enviada ao cliente) para dar visibilidade do que a distribuição fez.
 * Observabilidade — nunca derruba a distribuição se falhar.
 */
async function postDistributionNote(
  conversationId: string | null | undefined,
  content: string,
): Promise<void> {
  if (!conversationId) return;
  try {
    const saved = await prisma.message.create({
      data: withOrgFromCtx({
        conversationId,
        content,
        direction: "out",
        messageType: "note",
        isPrivate: true,
        senderName: "Distribuição",
      }),
    });
    await prisma.conversation
      .update({ where: { id: conversationId }, data: { updatedAt: new Date() } })
      .catch(() => {});
    sseBus.publish("new_message", {
      organizationId: getOrgIdOrNull(),
      conversationId,
      direction: "out",
      content,
      timestamp: saved.createdAt,
    });
  } catch (e) {
    console.error("[distribution] falha ao postar nota no chat", e);
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

async function writeLog(
  input: ExecuteDistributionInput,
  success: boolean,
  reason: DistributionReason,
  selectedUserId: string | null,
  evaluated: EvaluatedResponsibleSummary[],
): Promise<void> {
  try {
    await prisma.distributionLog.create({
      data: {
        organizationId: getOrgIdOrThrow(),
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

  // Distribuição por departamento (toggle org). Modo ligado sem departamento
  // resolvível → não distribui (fallback = fila), respeitando a fronteira.
  const deptScope = await resolveDepartmentScope(input);
  if (deptScope.enabled && !deptScope.departmentId) {
    await writeLog(input, false, "NO_DEPARTMENT", null, []);
    await enqueuePending(input);
    await postDistributionNote(
      input.conversationId,
      "⏳ A distribuição por departamento está ativa, mas este lead ainda não tem departamento definido. Ele entrou na fila de espera e será distribuído quando for roteado a um departamento.",
    );
    await emitDistributionEvent(input, false, "NO_DEPARTMENT", null, null, null);
    return {
      success: false,
      reason: "NO_DEPARTMENT",
      selectedUserId: null,
      selectedUserName: null,
      evaluated: [],
    };
  }

  const responsibles = await getDistributionResponsibles({
    distributionType: input.distributionType ?? null,
    now: input.now,
    departmentId: deptScope.enabled ? deptScope.departmentId : null,
  });
  const evaluated = toSummary(responsibles);
  const eligible = responsibles.filter((r) => r.eligible);

  if (eligible.length === 0) {
    // Ninguém elegível: não força atribuição. Registra no log E enfileira o
    // lead na fila de espera, para redistribuir quando alguém ficar ONLINE.
    await writeLog(input, false, "NO_ELIGIBLE_RESPONSIBLE", null, evaluated);
    await enqueuePending(input);
    await postDistributionNote(
      input.conversationId,
      "⏳ Nenhum responsável disponível para distribuição agora. O lead entrou na fila de espera e será redistribuído automaticamente quando alguém ficar online.",
    );
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
  await postDistributionNote(
    input.conversationId,
    `🔀 Lead distribuído para ${selected.name ?? "responsável"} pela Distribuição Inteligente.`,
  );
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

  // Simulação: se o modo por-departamento estiver ligado E houver depto
  // resolvível (explícito/conversa), escopa; sem depto, simula org-wide
  // (o "testar" genérico não tem lead atrelado).
  const deptScope = await resolveDepartmentScope(input);

  const responsibles = await getDistributionResponsibles({
    distributionType: input.distributionType ?? null,
    now: input.now,
    departmentId: deptScope.departmentId,
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
