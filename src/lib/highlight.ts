/**
 * Formatação condicional dos campos personalizados no painel lateral.
 *
 * O admin configura, por campo, uma lista de regras (`HighlightRule[]`)
 * gravada em `CustomField.highlightRules` (JSON). Quando uma regra casa com
 * o valor do campo, o valor é exibido na UI como um badge colorido conforme
 * a `severity`. A primeira regra que casa vence.
 */

export type HighlightSeverity = "danger" | "success" | "warning" | "info";

export type HighlightOp =
  | "equals"
  | "notEquals"
  | "contains"
  | "notEmpty"
  | "empty";

export type HighlightRule = {
  op: HighlightOp;
  /** Não usado em `notEmpty`/`empty`. */
  value?: string;
  severity: HighlightSeverity;
  /** Rótulo do badge; quando ausente usa o próprio valor do campo. */
  label?: string;
};

export type ResolvedHighlight = {
  severity: HighlightSeverity;
  label: string;
};

const SEVERITIES: ReadonlySet<string> = new Set([
  "danger",
  "success",
  "warning",
  "info",
]);

const OPS: ReadonlySet<string> = new Set([
  "equals",
  "notEquals",
  "contains",
  "notEmpty",
  "empty",
]);

function normalize(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Valida/parseia o JSON livre vindo do banco ou do request para
 * `HighlightRule[]`, descartando entradas malformadas.
 */
export function parseHighlightRules(raw: unknown): HighlightRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: HighlightRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const op = typeof r.op === "string" ? r.op : "";
    const severity = typeof r.severity === "string" ? r.severity : "";
    if (!OPS.has(op) || !SEVERITIES.has(severity)) continue;
    const needsValue = op !== "notEmpty" && op !== "empty";
    const value = typeof r.value === "string" ? r.value : undefined;
    if (needsValue && (value === undefined || value === "")) continue;
    const label = typeof r.label === "string" && r.label.trim() !== "" ? r.label : undefined;
    rules.push({ op: op as HighlightOp, value, severity: severity as HighlightSeverity, label });
  }
  return rules;
}

function matches(rule: HighlightRule, value: string | null | undefined): boolean {
  const filled = value !== null && value !== undefined && value !== "";
  switch (rule.op) {
    case "empty":
      return !filled;
    case "notEmpty":
      return filled;
    case "equals":
      return filled && normalize(value!) === normalize(rule.value ?? "");
    case "notEquals":
      return filled && normalize(value!) !== normalize(rule.value ?? "");
    case "contains":
      return filled && normalize(value!).includes(normalize(rule.value ?? ""));
    default:
      return false;
  }
}

/**
 * Resolve a primeira regra que casa com o valor. Retorna `null` quando não
 * há destaque. `rules` pode ser o JSON cru do banco (será parseado).
 */
export function resolveHighlight(
  value: string | null | undefined,
  rules: unknown,
): ResolvedHighlight | null {
  const parsed = parseHighlightRules(rules);
  if (parsed.length === 0) return null;
  for (const rule of parsed) {
    if (matches(rule, value)) {
      return {
        severity: rule.severity,
        label: rule.label ?? (value ?? "").toString(),
      };
    }
  }
  return null;
}
