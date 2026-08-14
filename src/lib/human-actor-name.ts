/**
 * Nome curto do agente humano em EVENTOS do chat (primeiro + segundo).
 * User.name é o campo canônico do CRM — não há firstName/lastName.
 */

const RESERVED = new Set([
  "agente",
  "agente ia",
  "sistema",
  "automação",
  "automacao",
]);

export function isReservedEventActorLabel(
  label: string | null | undefined,
): boolean {
  const n = (label ?? "").trim().toLowerCase();
  if (!n) return false;
  if (RESERVED.has(n)) return true;
  return n.startsWith("agente ia");
}

/** Placeholder genérico gravado nos eventos antigos. */
export function isGenericHumanEventActor(
  label: string | null | undefined,
): boolean {
  const n = (label ?? "").trim().toLowerCase();
  return n === "" || n === "agente";
}

export function formatHumanActorDisplayName(
  name?: string | null,
  email?: string | null,
): string {
  const raw = (name ?? "").trim();
  if (raw.includes("@") && !/\s/.test(raw)) {
    return raw.split("@")[0] || "";
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  if (parts.length === 1) return parts[0];
  const local = (email ?? "").trim().split("@")[0];
  return local || "";
}

export function humanActorDisplayNameOrFallback(
  name?: string | null,
  email?: string | null,
  fallback = "Agente",
): string {
  return formatHumanActorDisplayName(name, email) || fallback;
}
