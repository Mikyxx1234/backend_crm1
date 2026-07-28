/**
 * Schema do node "Round Robin de caminhos" (estilo Kommo).
 *
 * NÃO atribui agente — só escolhe qual caminho do fluxo seguir, em
 * rodízio circular entre execuções da mesma automação+step. Cada opção
 * linka a um `nextStepId` (como as branches da `condition`), sem saída
 * "else" obrigatória: se a opção sorteada não tiver destino, o
 * executor avança pra próxima em ordem circular (no máximo 1 volta
 * completa) — ver `case "round_robin"` em `automation-executor.ts`.
 *
 *   round_robin.config = {
 *     options: [
 *       { id: "opt_abc", label: "Opção 1", nextStepId: "step_xyz" },
 *       { id: "opt_def", label: "Opção 2" },
 *     ]
 *   }
 *
 * O cursor (índice da última opção escolhida) fica persistido em
 * `AutomationRoundRobinState` (Prisma), chaveado por
 * `[automationId, stepId]`. Adicionar/remover opção muda a
 * "assinatura" (ids concatenados) e reseta o cursor pro início.
 */

export type RoundRobinOption = {
  id: string;
  label?: string;
  nextStepId?: string;
};

export type RoundRobinConfig = {
  options: RoundRobinOption[];
};

export const ROUND_ROBIN_MIN_OPTIONS = 2;
export const ROUND_ROBIN_MAX_OPTIONS = 20;

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export function newRoundRobinOptionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `opt_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `opt_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeOption(raw: unknown): RoundRobinOption {
  const o = asRecord(raw);
  return {
    id: typeof o.id === "string" && o.id ? o.id : newRoundRobinOptionId(),
    label: typeof o.label === "string" && o.label ? o.label : undefined,
    nextStepId:
      typeof o.nextStepId === "string" && o.nextStepId ? o.nextStepId : undefined,
  };
}

/**
 * Converte qualquer config pra `RoundRobinConfig` canônico. Sempre
 * garante `options.length >= ROUND_ROBIN_MIN_OPTIONS` — chame isto
 * antes de avaliar/renderizar (nunca confie que a config salva já tem
 * o mínimo, ex.: import de outro sistema ou config antiga incompleta).
 */
export function normalizeRoundRobinConfig(raw: unknown): RoundRobinConfig {
  const c = asRecord(raw);
  const rawOptions = Array.isArray(c.options) ? c.options : [];
  const options = rawOptions.map(normalizeOption);

  while (options.length < ROUND_ROBIN_MIN_OPTIONS) {
    options.push({ id: newRoundRobinOptionId() });
  }

  return { options: options.slice(0, ROUND_ROBIN_MAX_OPTIONS) };
}

/** Assinatura estável da lista de opções — usada pra detectar add/remove e resetar o cursor. */
export function roundRobinOptionsSignature(options: RoundRobinOption[]): string {
  return options.map((o) => o.id).join(",");
}

/** Label default "Opção N" quando o operador não renomeou. */
export function roundRobinOptionLabel(option: RoundRobinOption, idx: number): string {
  return option.label?.trim() || `Opção ${idx + 1}`;
}

export function summarizeRoundRobinConfig(raw: unknown): string {
  const cfg = normalizeRoundRobinConfig(raw);
  const n = cfg.options.length;
  return `Round Robin (${n} ${n === 1 ? "opção" : "opções"})`;
}
