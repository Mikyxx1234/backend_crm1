/**
 * Schema da condicional multi-branch (estilo Kommo).
 *
 * A condition deixou de ser um simples SIM/NAO. Agora um `condition`
 * tem N branches avaliados em ordem; a primeira branch cujo conjunto de
 * `rules` bater (AND entre rules) dispara o caminho daquele branch. Se
 * nenhum branch bater, caimos no `elseStepId`.
 *
 *   condition.config = {
 *     branches: [
 *       {
 *         id: "branch_abc",
 *         label: "Entrada manual",           // opcional
 *         rules: [
 *           { field: "variables.resposta", op: "eq", value: "manual" },
 *           { field: "contact.leadScore",  op: "gt", value: 50 }  // AND
 *         ],
 *         nextStepId: "step_xyz"             // pra onde vai se bater
 *       },
 *       { ... outro branch ... }
 *     ],
 *     elseStepId: "step_fallback"            // nenhuma bateu
 *   }
 *
 * Também mantém retrocompat lendo o formato antigo `{ path, op, value,
 * elseStepId }` e migrando pra 1 branch com 1 rule.
 */

export type ConditionOp =
  | "eq"
  | "ne"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "includes"
  | "starts_with"
  | "ends_with"
  | "empty"
  | "not_empty";

export type ConditionRule = {
  field: string;
  op: ConditionOp;
  value: unknown;
};

export type ConditionBranch = {
  id: string;
  label?: string;
  rules: ConditionRule[];
  nextStepId?: string;
};

export type ConditionConfig = {
  branches: ConditionBranch[];
  elseStepId?: string;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export function newBranchId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `branch_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `branch_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeOp(raw: unknown): ConditionOp {
  const s = String(raw ?? "eq").toLowerCase();
  // aliases usados por versões antigas / UI
  if (s === "equals") return "eq";
  if (s === "not_equals") return "ne";
  if (s === "greater_than") return "gt";
  if (s === "less_than") return "lt";
  if (s === "greater_or_equal") return "gte";
  if (s === "less_or_equal") return "lte";
  if (s === "contains") return "includes";
  const allowed: ConditionOp[] = [
    "eq", "ne", "gt", "lt", "gte", "lte",
    "includes", "starts_with", "ends_with",
    "empty", "not_empty",
  ];
  return (allowed.includes(s as ConditionOp) ? s : "eq") as ConditionOp;
}

function normalizeRule(raw: unknown): ConditionRule | null {
  const r = asRecord(raw);
  const field = String(r.field ?? r.path ?? r.left ?? "").trim();
  if (!field) return null;
  return {
    field,
    op: normalizeOp(r.op ?? r.operator),
    value: r.value ?? r.right ?? "",
  };
}

function normalizeBranch(raw: unknown): ConditionBranch | null {
  const b = asRecord(raw);
  const rawRules = Array.isArray(b.rules) ? b.rules : [];
  const rules = rawRules.map(normalizeRule).filter((x): x is ConditionRule => x !== null);
  if (rules.length === 0) return null;
  return {
    id: typeof b.id === "string" && b.id ? b.id : newBranchId(),
    label: typeof b.label === "string" ? b.label : undefined,
    rules,
    nextStepId: typeof b.nextStepId === "string" && b.nextStepId ? b.nextStepId : undefined,
  };
}

/**
 * Converte qualquer config (novo ou antigo) pra ConditionConfig
 * canônico. Chame isto antes de avaliar / renderizar.
 */
export function normalizeConditionConfig(raw: unknown): ConditionConfig {
  const c = asRecord(raw);

  // Formato novo
  if (Array.isArray(c.branches)) {
    const branches = c.branches
      .map(normalizeBranch)
      .filter((b): b is ConditionBranch => b !== null);
    return {
      branches,
      elseStepId:
        typeof c.elseStepId === "string" && c.elseStepId ? c.elseStepId : undefined,
    };
  }

  // Formato antigo `{ path, op, value, elseStepId }` → migra pra 1 branch.
  const legacyField = String(c.path ?? c.field ?? c.left ?? "").trim();
  if (legacyField) {
    const rule: ConditionRule = {
      field: legacyField,
      op: normalizeOp(c.op ?? c.operator),
      value: c.value ?? c.right ?? "",
    };
    // O nextStepId do step legado era o "caminho SIM" — vira nextStepId
    // do primeiro branch pra preservar o comportamento.
    const legacyNext =
      typeof c.nextStepId === "string" && c.nextStepId && c.nextStepId !== "__none__"
        ? c.nextStepId
        : undefined;
    return {
      branches: [
        {
          id: newBranchId(),
          rules: [rule],
          nextStepId: legacyNext,
        },
      ],
      elseStepId:
        typeof c.elseStepId === "string" && c.elseStepId ? c.elseStepId : undefined,
    };
  }

  return { branches: [], elseStepId: undefined };
}

/**
 * Retorna uma string curta pro summary dentro do node. Mostra a
 * primeira regra da primeira branch + qtd de branches extras.
 */
export function summarizeConditionConfig(raw: unknown): string {
  const cfg = normalizeConditionConfig(raw);
  if (cfg.branches.length === 0) return "Definir regra";
  const first = cfg.branches[0];
  const firstRule = first.rules[0];
  const base = firstRule
    ? `${firstRule.field} ${firstRule.op} ${String(firstRule.value ?? "").slice(0, 20)}`
    : first.label ?? "Branch 1";
  const extras =
    cfg.branches.length > 1
      ? ` · +${cfg.branches.length - 1} ${cfg.branches.length - 1 === 1 ? "condição" : "condições"}`
      : "";
  return base + extras;
}
