/**
 * Política quando não há consultor humano elegível:
 *  - avisa indisponibilidade e oferece continuar com a IA;
 *  - se o aluno pedir distribuição/humano, informa horário de início
 *    (8h seg–sex, 9h sábado, América/São_Paulo) e mantém a fila.
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

/** Seg–sex → 8h; sábado → 9h; domingo → segunda às 8h. */
export function humanAttendanceStartHint(now = new Date()): {
  startHour: 8 | 9;
  dayLabel: string;
} {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
  }).format(now);
  // Sun Mon Tue Wed Thu Fri Sat
  if (weekday === "Sat") {
    return { startHour: 9, dayLabel: "hoje (sábado)" };
  }
  if (weekday === "Sun") {
    return { startHour: 8, dayLabel: "segunda-feira" };
  }
  return { startHour: 8, dayLabel: "hoje" };
}

export function buildHumanUnavailableOfferMessage(now = new Date()): string {
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
  const { startHour, dayLabel } = humanAttendanceStartHint(now);
  return (
    `Combinado! Você já está na *fila* do atendimento humano. ` +
    `O expediente inicia às *${startHour}h* ${dayLabel} ` +
    `(segunda a sexta às 8h e sábado às 9h). ` +
    `Assim que um(a) consultor(a) estiver disponível, te atendem, tá?`
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
  "eu posso continuar",
  "já está na fila",
  "ja esta na fila",
  "expediente inicia",
  "segunda a sexta às 8h",
  "segunda a sexta as 8h",
  "só mais um pouquinho",
  "so mais um pouquinho",
  "fala com você em breve",
  "fala com voce em breve",
  "vou te conectar",
] as const;

export function messageLooksLikeHumanQueueNotice(content: string | null | undefined): boolean {
  if (!content) return false;
  const n = normalizeMsg(content);
  return HUMAN_QUEUE_MSG_PATTERNS.some((p) => n.includes(normalizeMsg(p)));
}
