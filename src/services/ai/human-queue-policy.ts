/**
 * Política quando não há consultor humano elegível:
 *  - avisa indisponibilidade e oferece continuar com a IA;
 *  - se o aluno pedir distribuição/humano fora do expediente, informa horário;
 *  - dentro do expediente, não diz "inicia às 8h" (já começou).
 */

const TZ = "America/Sao_Paulo";

function normalizeMsg(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function clockInSaoPaulo(now = new Date()): {
  weekday: string;
  hour: number;
  minute: number;
} {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
  }).format(now);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { weekday, hour: hour === 24 ? 0 : hour, minute };
}

/** Seg–sex → 8h; sábado → 9h; domingo → segunda às 8h. */
export function humanAttendanceStartHint(now = new Date()): {
  startHour: 8 | 9;
  dayLabel: string;
} {
  const { weekday } = clockInSaoPaulo(now);
  if (weekday === "Sat") {
    return { startHour: 9, dayLabel: "hoje (sábado)" };
  }
  if (weekday === "Sun") {
    return { startHour: 8, dayLabel: "segunda-feira" };
  }
  return { startHour: 8, dayLabel: "hoje" };
}

/** True se já estamos no horário de início do atendimento humano (SP). */
export function isHumanAttendanceWindowOpen(now = new Date()): boolean {
  const { weekday, hour, minute } = clockInSaoPaulo(now);
  if (weekday === "Sun") return false;
  const startHour = weekday === "Sat" ? 9 : 8;
  const mins = hour * 60 + minute;
  return mins >= startHour * 60;
}

function hoursFooter(now = new Date()): string {
  if (isHumanAttendanceWindowOpen(now)) {
    return (
      `Assim que um(a) consultor(a) estiver disponível, te atendem ` +
      `(expediente: segunda a sexta a partir das 8h e sábado a partir das 9h).`
    );
  }
  const { startHour, dayLabel } = humanAttendanceStartHint(now);
  return (
    `O atendimento humano inicia às *${startHour}h* ${dayLabel} ` +
    `(segunda a sexta às 8h e sábado às 9h).`
  );
}

export function buildHumanUnavailableOfferMessage(now = new Date()): string {
  if (isHumanAttendanceWindowOpen(now)) {
    return (
      `No momento o *atendimento humano* está indisponível ` +
      `(nenhum consultor elegível agora). ` +
      `Se quiser, *eu posso continuar* te ajudando por aqui. ` +
      `Se preferir aguardar um(a) consultor(a), é só pedir — ` +
      `você fica na fila e te atendem assim que alguém estiver disponível.`
    );
  }
  const { startHour, dayLabel } = humanAttendanceStartHint(now);
  return (
    `No momento o *atendimento humano* está indisponível. ` +
    `Se quiser, *eu posso continuar* te ajudando por aqui. ` +
    `Se preferir aguardar um(a) consultor(a), é só pedir — ` +
    `o atendimento humano inicia às *${startHour}h* ${dayLabel} ` +
    `(segunda a sexta às 8h e sábado às 9h) e você fica na fila.`
  );
}

export function buildHumanQueueWithHoursMessage(now = new Date()): string {
  return (
    `Combinado! Você já está na *fila* do atendimento humano. ` +
    `${hoursFooter(now)}`
  );
}

/** Pedido explícito de fila / humano / consultor / distribuição. */
export function userWantsHumanDistribution(userMessage: string): boolean {
  const n = normalizeMsg(userMessage);
  if (!n) return false;
  if (
    /\b(atendente|humano|consultor|consultora|atendimento humano)\b/.test(n)
  ) {
    return true;
  }
  if (
    /falar com (alguem|atendente|humano|consultor)|quero (um )?atendente|passar (para|pro) (humano|atendente|consultor)/.test(
      n,
    )
  ) {
    return true;
  }
  if (
    /\b(fila|aguardar (o )?consultor|espera(r)? (o )?consultor|distribu)/.test(
      n,
    )
  ) {
    return true;
  }
  return false;
}

/** Aluno pede para a IA continuar (após oferta de indisponibilidade). */
export function userWantsAiContinue(userMessage: string): boolean {
  const n = normalizeMsg(userMessage);
  if (!n) return false;
  if (userWantsHumanDistribution(userMessage)) return false;
  return (
    /pode continuar|continua(r)?( me)? (ajud|atend)|voce (pode )?ajud|quero (sua|a) ajuda|pode me ajudar|segue( comigo)?|pode sim|quero (que )?voce/.test(
      n,
    ) ||
    /^(pode|quero|sim|continuar|continua)[\s!.]*$/.test(n)
  );
}

/** Mensagens já usadas neste fluxo (dedupe). */
export const HUMAN_QUEUE_MSG_PATTERNS = [
  "atendimento humano está indisponível",
  "atendimento humano esta indisponivel",
  "nenhum consultor elegivel",
  "nenhum consultor elegível",
  "eu posso continuar",
  "já está na fila",
  "ja esta na fila",
  "expediente inicia",
  "atendimento humano inicia",
  "segunda a sexta às 8h",
  "segunda a sexta as 8h",
  "a partir das 8h",
  "só mais um pouquinho",
  "so mais um pouquinho",
  "fala com você em breve",
  "fala com voce em breve",
  "vou te conectar",
] as const;

export function messageLooksLikeHumanQueueNotice(
  content: string | null | undefined,
): boolean {
  if (!content) return false;
  const n = normalizeMsg(content);
  return HUMAN_QUEUE_MSG_PATTERNS.some((p) => n.includes(normalizeMsg(p)));
}

/** Normaliza texto para comparação de near-duplicate. */
export function normalizeForDedupe(raw: string): string {
  return normalizeMsg(raw).replace(/[^\p{L}\p{N}\s]/gu, "");
}

/**
 * True se `candidate` é praticamente a mesma informação de `existing`
 * (template de fila/conexão ou overlap alto de tokens).
 */
export function isNearDuplicateBotText(
  candidate: string,
  existing: string,
): boolean {
  const a = normalizeForDedupe(candidate);
  const b = normalizeForDedupe(existing);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    if (shorter >= 40 && shorter / longer >= 0.7) return true;
  }
  const queueA = messageLooksLikeHumanQueueNotice(candidate);
  const queueB = messageLooksLikeHumanQueueNotice(existing);
  if (queueA && queueB) return true;
  if (a.includes("vou te conectar") && b.includes("vou te conectar")) {
    return true;
  }
  const ta = new Set(a.split(" ").filter((w) => w.length > 2));
  const tb = new Set(b.split(" ").filter((w) => w.length > 2));
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= 0.7;
}
