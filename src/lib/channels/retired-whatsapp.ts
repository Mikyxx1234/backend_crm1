/**
 * Números WhatsApp aposentados (ex.: CSV Atendimento 4535).
 * Inbound e IA não devem atender — mesmo se o canal voltar CONNECTED.
 */

/** Meta Cloud `phone_number_id` do CSV Atendimento +55 11 91518-4535. */
export const RETIRED_CSV_ATENDIMENTO_PHONE_NUMBER_ID = "883452561518366";

const RETIRED_META_PHONE_NUMBER_IDS = new Set<string>([
  RETIRED_CSV_ATENDIMENTO_PHONE_NUMBER_ID,
]);

const RETIRED_PHONE_DIGITS = ["11915184535", "5511915184535"] as const;

const RETIRED_CHANNEL_NAMES = new Set(["csv atendimento"]);

function digitsOnly(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D+/g, "");
}

function extraIgnoredMetaPhoneNumberIds(): string[] {
  const raw = process.env.META_IGNORE_PHONE_NUMBER_IDS ?? "";
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isRetiredMetaPhoneNumberId(
  phoneNumberId: string | null | undefined,
): boolean {
  const id = (phoneNumberId ?? "").trim();
  if (!id) return false;
  if (RETIRED_META_PHONE_NUMBER_IDS.has(id)) return true;
  return extraIgnoredMetaPhoneNumberIds().includes(id);
}

export function isRetiredWhatsAppChannel(ch: {
  name?: string | null;
  phoneNumber?: string | null;
  config?: unknown;
} | null | undefined): boolean {
  if (!ch) return false;
  const name = (ch.name ?? "").trim().toLowerCase();
  if (name && RETIRED_CHANNEL_NAMES.has(name)) return true;
  const digits = digitsOnly(ch.phoneNumber);
  if (
    digits &&
    RETIRED_PHONE_DIGITS.some((d) => digits === d || digits.endsWith(d))
  ) {
    return true;
  }
  const cfg = (ch.config ?? null) as Record<string, unknown> | null;
  const pid = String(cfg?.phoneNumberId ?? "").trim();
  return isRetiredMetaPhoneNumberId(pid);
}
