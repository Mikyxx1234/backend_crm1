/**
 * Regra ÚNICA de elegibilidade da Distribuição Inteligente.
 *
 * Esta é a fonte de verdade usada por TODOS os consumidores: a tela
 * (`getDistributionResponsibles`), a simulação (`simulateDistribution`), a
 * distribuição real e a automação (`executeDistribution`). Mantê-la aqui,
 * pura e sem IO, garante que o que a tela mostra é exatamente o que o motor
 * decide.
 *
 * Estados (não se misturam — alinhado à UI):
 *  - `INACTIVE`             → bloqueio administrativo (`participates = false`).
 *  - `ON_PAUSE`             → pausa temporária (`paused = true` OU AgentStatus AWAY).
 *  - `OFFLINE`              → presença offline (AgentStatus OFFLINE OU sem registro).
 *  - `OUTSIDE_WORKING_HOURS`→ fora do expediente (AgentSchedule).
 *  - `QUEUE_LIMIT_REACHED`  → fila cheia (`queueLimit > 0 && filaAtual >= queueLimit`).
 *  - `TYPE_INCOMPATIBLE`    → tipo/segmento do responsável != tipo solicitado.
 *
 * Compatibilidade: a lógica de presença/expediente espelha o legado
 * `isAgentAvailable` (sem registro de AgentStatus = disponível; sem
 * AgentSchedule = sem restrição de horário).
 */

import type { AgentOnlineStatus } from "@prisma/client";

export type DistributionBlockReason =
  | "INACTIVE"
  | "OFFLINE"
  | "ON_PAUSE"
  | "OUTSIDE_WORKING_HOURS"
  | "QUEUE_LIMIT_REACHED"
  | "TYPE_INCOMPATIBLE";

/** Subconjunto do AgentSchedule necessário para o cálculo de expediente. */
export interface ScheduleLike {
  startTime: string;
  lunchStart: string;
  lunchEnd: string;
  endTime: string;
  timezone: string;
  weekdays: number[];
}

export interface ResponsibleEligibilityInput {
  /** Status administrativo: false = INATIVO. */
  participates: boolean;
  /** Pausa temporária dedicada. */
  paused: boolean;
  /** 0 = sem limite; >0 bloqueia quando filaAtual >= queueLimit. */
  queueLimit: number;
  /** Tipo/segmento opcional do responsável. */
  type: string | null;
  /** Presença operacional. `null` = sem registro (tratado como ONLINE). */
  status: AgentOnlineStatus | null;
  /** Expediente. `null` = sem restrição de horário. */
  schedule: ScheduleLike | null;
  /** Fila atual (deals OPEN com este owner). */
  queueCount: number;
}

export interface EligibilityContext {
  /** Tipo/segmento solicitado pela distribuição (para `TYPE_INCOMPATIBLE`). */
  distributionType?: string | null;
  /** Momento de referência (testes/simulação). Default: agora. */
  now?: Date;
}

export interface EligibilityResult {
  eligible: boolean;
  blockedReasons: DistributionBlockReason[];
}

/** "HH:MM" → minutos desde a meia-noite. */
function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * True se `now` está dentro do expediente do `schedule` (timezone-aware,
 * respeitando dias da semana e intervalo de almoço). Espelha o legado
 * `isAgentAvailable`.
 */
export function isWithinWorkingHours(schedule: ScheduleLike, now: Date): boolean {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts = formatter.formatToParts(now);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "";
  const currentWeekday = WEEKDAY_MAP[weekdayStr] ?? now.getDay();

  if (!schedule.weekdays.includes(currentWeekday)) return false;

  const currentMinutes = parseInt(hour, 10) * 60 + parseInt(minute, 10);
  const startMinutes = parseTime(schedule.startTime);
  const endMinutes = parseTime(schedule.endTime);
  const lunchStartMinutes = parseTime(schedule.lunchStart);
  const lunchEndMinutes = parseTime(schedule.lunchEnd);

  if (currentMinutes < startMinutes || currentMinutes >= endMinutes) return false;
  if (currentMinutes >= lunchStartMinutes && currentMinutes < lunchEndMinutes) {
    return false;
  }
  return true;
}

/**
 * Avalia a elegibilidade de um responsável. Retorna `eligible` + a lista
 * completa de `blockedReasons` (não para no primeiro motivo — a tela mostra
 * todos). Função pura: receba os dados já carregados.
 */
export function evaluateResponsibleEligibility(
  input: ResponsibleEligibilityInput,
  ctx: EligibilityContext = {},
): EligibilityResult {
  const reasons: DistributionBlockReason[] = [];

  if (!input.participates) reasons.push("INACTIVE");

  // Presença REAL: sem registro de AgentStatus = OFFLINE. O responsável só
  // é elegível se ficou online de propósito (PUT /api/agents/[id]/status).
  const status: AgentOnlineStatus = input.status ?? "OFFLINE";
  if (input.paused || status === "AWAY") {
    reasons.push("ON_PAUSE");
  } else if (status === "OFFLINE") {
    reasons.push("OFFLINE");
  }

  if (input.schedule && !isWithinWorkingHours(input.schedule, ctx.now ?? new Date())) {
    reasons.push("OUTSIDE_WORKING_HOURS");
  }

  if (input.queueLimit > 0 && input.queueCount >= input.queueLimit) {
    reasons.push("QUEUE_LIMIT_REACHED");
  }

  const requested = ctx.distributionType?.trim();
  const ownType = input.type?.trim();
  if (requested && ownType && ownType !== requested) {
    reasons.push("TYPE_INCOMPATIBLE");
  }

  return { eligible: reasons.length === 0, blockedReasons: reasons };
}
