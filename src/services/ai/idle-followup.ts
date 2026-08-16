/**
 * Follow-up de silêncio da IA.
 */

export const IDLE_NUDGE_MS = 30 * 60 * 1000;
export const IDLE_CLOSE_AFTER_NUDGE_MS = 30 * 60 * 1000;

/** Trecho estável para o worker reconhecer o check-in (não traduzir). */
export const IDLE_NUDGE_SIGNATURE =
  "faz uns 30 minutos que fiquei sem te ouvir";

export function normalizeIdleText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

export function buildIdleNudgeMessage(): string {
  return (
    `Oi, tudo bem? Faz uns 30 minutos que fiquei sem te ouvir 😊 ` +
    `Ainda posso te ajudar em alguma coisa, ou você já resolveu?`
  );
}

export function isIdleNudgeContent(content?: string | null): boolean {
  return normalizeIdleText(content ?? "").includes(IDLE_NUDGE_SIGNATURE);
}

/** Resposta clara ao check-in de que não precisa mais — sem "obrigado" sozinho. */
export function userWantsSoftAiClose(userMessage?: string | null): boolean {
  const msg = normalizeIdleText(userMessage ?? "")
    .replace(/[!?.…,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!msg || msg.length > 80) return false;
  if (
    /^(nao precisa( mais)?( de ajuda)?|nao preciso( mais)?( de (ajuda|nada))?)$/.test(
      msg,
    )
  ) {
    return true;
  }
  if (/^(era )?so isso( mesmo)?$/.test(msg) || /^e so isso$/.test(msg)) {
    return true;
  }
  if (/^(nao quero|pode deixar|deixa pra la|ja resolvi)$/.test(msg)) {
    return true;
  }
  return false;
}

export function daypartWish(now = new Date()): "dia" | "tarde" | "noite" {
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  if (hour >= 5 && hour < 12) return "dia";
  if (hour >= 12 && hour < 18) return "tarde";
  return "noite";
}

export function buildSoftCloseAfterNudgeReply(now = new Date()): string {
  return `Ok! Qualquer coisa é só chamar. Tenha um ótimo ${daypartWish(now)} 😊`;
}
