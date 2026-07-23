/**
 * Monta a visão de responsáveis da Distribuição: cada usuário humano da org
 * + sua config (`DistributionResponsible`, com defaults quando não existe) +
 * presença (`AgentStatus`) + expediente (`AgentSchedule`) + fila atual +
 * elegibilidade (via `eligibility.ts`, a regra única).
 *
 * Usado pela tela (`GET /api/distribution/responsibles`) e pelo motor
 * (`engine.ts`) — mesma fonte de dados garante consistência tela↔motor.
 */

import type { AgentOnlineStatus, UserRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getOrgIdOrThrow } from "@/lib/request-context";

import {
  evaluateResponsibleEligibility,
  type DistributionBlockReason,
  type EligibilityContext,
  type ScheduleLike,
} from "./eligibility";
import { getQueueCounts } from "./queue";

/** Defaults de config quando o usuário ainda não tem `DistributionResponsible`. */
const DEFAULT_RESPONSIBLE = {
  participates: true,
  queueLimit: 0,
  volume: 1,
  type: null as string | null,
  paused: false,
  lastExecutionAt: null as Date | null,
};

export interface DistributionResponsibleView {
  userId: string;
  name: string | null;
  email: string | null;
  role: UserRole;
  /** Config administrativa. */
  participates: boolean;
  queueLimit: number;
  volume: number;
  type: string | null;
  paused: boolean;
  lastExecutionAt: string | null;
  /** Presença operacional (null = sem registro). */
  status: AgentOnlineStatus | null;
  /** Tem expediente configurado. */
  hasSchedule: boolean;
  /** Fila atual (deals OPEN). */
  queueCount: number;
  /** Resultado da regra única. */
  eligible: boolean;
  blockedReasons: DistributionBlockReason[];
}

export interface GetResponsiblesOptions {
  /** Tipo/segmento solicitado (avalia `TYPE_INCOMPATIBLE`). */
  distributionType?: string | null;
  /** Momento de referência (simulação/teste). */
  now?: Date;
  /**
   * Distribuição por departamento: quando definido, responsáveis que NÃO são
   * membros deste departamento (`DepartmentMember`) recebem o bloqueio
   * `DEPARTMENT_MISMATCH` (inelegíveis). `null`/undefined = modo desligado.
   */
  departmentId?: string | null;
}

export async function getDistributionResponsibles(
  opts: GetResponsiblesOptions = {},
): Promise<DistributionResponsibleView[]> {
  const orgId = getOrgIdOrThrow();

  // User NÃO é org-scoped na Prisma Extension — filtro manual obrigatório.
  const users = await prisma.user.findMany({
    where: { type: "HUMAN", organizationId: orgId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, role: true },
  });
  if (users.length === 0) return [];

  const userIds = users.map((u) => u.id);

  // Distribuição por departamento: carrega os membros do departamento-alvo
  // para marcar quem está dentro/fora. Vazio (Set) quando modo desligado.
  const departmentMemberIds = opts.departmentId
    ? new Set(
        (
          await prisma.departmentMember.findMany({
            where: { departmentId: opts.departmentId, userId: { in: userIds } },
            select: { userId: true },
          })
        ).map((m) => m.userId),
      )
    : null;

  const [responsibles, statuses, schedules, queue] = await Promise.all([
    prisma.distributionResponsible.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        participates: true,
        queueLimit: true,
        volume: true,
        type: true,
        paused: true,
        lastExecutionAt: true,
      },
    }),
    prisma.agentStatus.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, status: true },
    }),
    prisma.agentSchedule.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        startTime: true,
        lunchStart: true,
        lunchEnd: true,
        endTime: true,
        timezone: true,
        weekdays: true,
      },
    }),
    getQueueCounts(userIds),
  ]);

  const respByUser = new Map(responsibles.map((r) => [r.userId, r]));
  const statusByUser = new Map(statuses.map((s) => [s.userId, s.status]));
  const scheduleByUser = new Map<string, ScheduleLike>(
    schedules.map((s) => [
      s.userId,
      {
        startTime: s.startTime,
        lunchStart: s.lunchStart,
        lunchEnd: s.lunchEnd,
        endTime: s.endTime,
        timezone: s.timezone,
        weekdays: s.weekdays,
      },
    ]),
  );

  const eligibilityCtx: EligibilityContext = {
    distributionType: opts.distributionType ?? null,
    now: opts.now,
  };

  return users.map((u) => {
    const cfg = respByUser.get(u.id) ?? DEFAULT_RESPONSIBLE;
    const status = statusByUser.get(u.id) ?? null;
    const schedule = scheduleByUser.get(u.id) ?? null;
    const queueCount = queue.get(u.id) ?? 0;

    const { eligible, blockedReasons } = evaluateResponsibleEligibility(
      {
        participates: cfg.participates,
        paused: cfg.paused,
        queueLimit: cfg.queueLimit,
        type: cfg.type,
        status,
        schedule,
        queueCount,
        // undefined = modo desligado (sem restrição); false = fora do depto.
        inDepartment: departmentMemberIds ? departmentMemberIds.has(u.id) : undefined,
      },
      eligibilityCtx,
    );

    return {
      userId: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      participates: cfg.participates,
      queueLimit: cfg.queueLimit,
      volume: cfg.volume,
      type: cfg.type,
      paused: cfg.paused,
      lastExecutionAt: cfg.lastExecutionAt
        ? cfg.lastExecutionAt.toISOString()
        : null,
      status,
      hasSchedule: schedule !== null,
      queueCount,
      eligible,
      blockedReasons,
    };
  });
}
