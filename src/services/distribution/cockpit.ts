/**
 * Métricas do "Cockpit do Agente" — painel operacional (herdeiro do cockpit do
 * DataCrazy) migrado para o CRM novo. Lê da mesma fonte do motor de
 * distribuição (`responsibles.ts`, já corrigido) + `DistributionLog` +
 * conversas OPEN. É SOMENTE LEITURA e escopado à organização do token.
 *
 * Consumido por `GET /api/public/agent-cockpit` (Bearer token) e renderizado
 * pelo dashboard estático `public/cockpit-agente.html`.
 */

import { prisma } from "@/lib/prisma";
import { getOrgIdOrThrow } from "@/lib/request-context";

import { getDistributionResponsibles } from "./responsibles";

export interface CockpitAgent {
  userId: string;
  name: string | null;
  archetype: string;
  active: boolean;
  /** Conversas OPEN atualmente atribuídas ao agente (atendendo agora). */
  attendingNow: number;
}

export interface CockpitConsultant {
  userId: string;
  name: string | null;
  departments: string[];
  /** Carga atual (conversas OPEN atribuídas) — mesma base do limite. */
  queueCount: number;
  /** 0 = sem limite. */
  queueLimit: number;
  status: string | null;
  eligible: boolean;
  /** Leads que ESTE consultor recebeu hoje pela distribuição. */
  receivedToday: number;
}

export interface CockpitData {
  generatedAt: string;
  totals: {
    /** Distribuições com sucesso hoje (todas as origens). */
    distributedToday: number;
    /** Distribuições feitas HOJE pelo agente IA (handoff, origem AI_AGENT). */
    distributedByAgentToday: number;
    /** Conversas OPEN atribuídas a agentes de IA agora. */
    attendingNow: number;
    /** Leads na fila de espera (sem responsável elegível). */
    pendingQueue: number;
  };
  agents: CockpitAgent[];
  consultants: CockpitConsultant[];
}

/** Meia-noite de hoje no fuso America/Sao_Paulo, como Date UTC. */
function startOfTodaySaoPaulo(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = parts.split("-").map(Number);
  // Brasil não usa mais horário de verão → offset fixo -03:00.
  // 00:00 -03:00 == 03:00 UTC do mesmo dia.
  return new Date(Date.UTC(y!, m! - 1, d!, 3, 0, 0));
}

export async function getCockpitData(): Promise<CockpitData> {
  const orgId = getOrgIdOrThrow();
  const since = startOfTodaySaoPaulo();

  const [agentConfigs, responsibles, distToday, byAgentToday, pendingQueue] =
    await Promise.all([
      prisma.aIAgentConfig.findMany({
        where: { organizationId: orgId },
        select: {
          userId: true,
          archetype: true,
          active: true,
          user: { select: { name: true } },
        },
      }),
      getDistributionResponsibles(),
      // Distribuições com sucesso hoje, por consultor selecionado.
      prisma.distributionLog.groupBy({
        by: ["selectedUserId"],
        where: {
          organizationId: orgId,
          success: true,
          createdAt: { gte: since },
          selectedUserId: { not: null },
        },
        _count: { _all: true },
      }),
      // Quantas dessas foram feitas pelo AGENTE IA (handoff → distribuição).
      // Origem AI_AGENT — distinto de AUTOMATION (workflows), que roda mesmo
      // com o agente desligado e não deve entrar neste card.
      prisma.distributionLog.count({
        where: {
          organizationId: orgId,
          success: true,
          createdAt: { gte: since },
          triggerSource: { contains: "AI_AGENT" },
        },
      }),
      prisma.distributionPending.count({
        where: { organizationId: orgId, status: "PENDING" },
      }),
    ]);

  const receivedByUser = new Map<string, number>();
  let distributedToday = 0;
  for (const row of distToday) {
    if (!row.selectedUserId) continue;
    receivedByUser.set(row.selectedUserId, row._count._all);
    distributedToday += row._count._all;
  }

  // Atendendo agora por agente (conversas OPEN atribuídas ao user do agente).
  const agentUserIds = agentConfigs.map((a) => a.userId);
  const attendingRows =
    agentUserIds.length > 0
      ? await prisma.conversation.groupBy({
          by: ["assignedToId"],
          where: {
            status: "OPEN",
            assignedToId: { in: agentUserIds },
          },
          _count: { _all: true },
        })
      : [];
  const attendingByAgent = new Map<string, number>();
  for (const row of attendingRows) {
    if (row.assignedToId) attendingByAgent.set(row.assignedToId, row._count._all);
  }

  const agents: CockpitAgent[] = agentConfigs.map((a) => ({
    userId: a.userId,
    name: a.user?.name ?? null,
    archetype: a.archetype,
    active: a.active,
    attendingNow: attendingByAgent.get(a.userId) ?? 0,
  }));

  const consultants: CockpitConsultant[] = responsibles
    .map((r) => ({
      userId: r.userId,
      name: r.name,
      departments: r.departments.map((d) => d.name),
      queueCount: r.queueCount,
      queueLimit: r.queueLimit,
      status: r.status,
      eligible: r.eligible,
      receivedToday: receivedByUser.get(r.userId) ?? 0,
    }))
    // Ordena por recebidos hoje (desc) e depois por fila — quem mais recebeu no topo.
    .sort(
      (a, b) => b.receivedToday - a.receivedToday || b.queueCount - a.queueCount,
    );

  const attendingNow = agents.reduce((s, a) => s + a.attendingNow, 0);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      distributedToday,
      distributedByAgentToday: byAgentToday,
      attendingNow,
      pendingQueue,
    },
    agents,
    consultants,
  };
}
