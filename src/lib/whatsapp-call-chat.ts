const DEFAULT_TZ = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";

export type CallBizOpaque = { userId?: string; agentName?: string };

export function buildCallBizOpaquePayload(userId: string, displayName: string): string {
  const n = (displayName.trim() || "Agente").slice(0, 200);
  const base = { u: userId, n };
  let s = JSON.stringify(base);
  if (s.length <= 512) return s;
  let name = n;
  while (name.length > 1) {
    name = name.slice(0, -1);
    s = JSON.stringify({ u: userId, n: name });
    if (s.length <= 512) return s;
  }
  return JSON.stringify({ u: userId }).slice(0, 512);
}

export function parseCallBizOpaque(raw: string | null | undefined): CallBizOpaque {
  if (!raw?.trim()) return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const userId =
      typeof o.u === "string"
        ? o.u
        : typeof o.userId === "string"
          ? o.userId
          : undefined;
    const agentName =
      typeof o.n === "string"
        ? o.n
        : typeof o.name === "string"
          ? o.name
          : undefined;
    return { userId, agentName };
  } catch {
    return {};
  }
}

export function formatCallHm(d: Date, timeZone = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function extractRecordingUrl(callObj: Record<string, unknown>): string | null {
  const top = typeof callObj.recording_url === "string" ? callObj.recording_url.trim() : "";
  if (/^https?:\/\//i.test(top)) return top;
  const r = callObj.recording;
  if (r && typeof r === "object" && !Array.isArray(r)) {
    const ro = r as Record<string, unknown>;
    const u = typeof ro.url === "string" ? ro.url.trim() : "";
    if (/^https?:\/\//i.test(u)) return u;
  }
  const s = typeof callObj.recording === "string" ? callObj.recording.trim() : "";
  if (/^https?:\/\//i.test(s)) return s;
  return null;
}

/**
 * String enxuta gerada quando o evento `connect` chega da Meta.
 * Mantém apenas Chamada + direção (entrada/saída) + horário — sem
 * `agente: X` redundante (o nome do agente já aparece como
 * `senderName`/avatar da mensagem). O CallActivityItem usa "entrada"/
 * "saída" como heurística de fallback caso `direction` não venha.
 */
export function buildConnectChatLine(params: {
  direction: string;
  eventTime: Date;
  agentName?: string;
}): string {
  const hm = formatCallHm(params.eventTime);
  if (params.direction === "USER_INITIATED") {
    return `Chamada · entrada · ${hm}`;
  }
  return `Chamada · saída · ${hm}`;
}

/**
 * String enxuta gerada quando a chamada termina. Preserva os tokens que o
 * `CallActivityItem` (`chat-window.tsx`) regex-extrai:
 *  - `fim`        → marca terminate
 *  - `falhou`     → marca falha
 *  - `13s`/`1m20s`→ duração
 *  - `18:22`      → horário
 *
 * Removidos: `· ok` (decoração — ausência de "falhou" já indica sucesso),
 * `· agente: X` (redundante com avatar/sender da mensagem) e o span
 * `HH:MM–HH:MM` quando início == fim (chamada de poucos segundos).
 */
export function buildTerminateChatLine(params: {
  terminateStatus: string;
  durationSec: number | null;
  startDate: Date | null;
  endDate: Date;
  agentName?: string;
}): string {
  const durShort =
    params.durationSec != null && params.durationSec > 0
      ? params.durationSec >= 60
        ? `${Math.floor(params.durationSec / 60)}m${String(params.durationSec % 60).padStart(2, "0")}s`
        : `${params.durationSec}s`
      : "";
  const st = params.terminateStatus;
  const hmStart = params.startDate ? formatCallHm(params.startDate) : null;
  const hmEnd = formatCallHm(params.endDate);
  const span = hmStart && hmStart !== hmEnd ? `${hmStart}–${hmEnd}` : hmEnd;

  if (st === "FAILED") {
    return `Chamada · fim · falhou · ${span}`;
  }
  return durShort
    ? `Chamada · fim · ${durShort} · ${span}`
    : `Chamada · fim · ${span}`;
}

/**
 * Resumo minimalista para a mensagem `whatsapp_call_recording`.
 * O chat renderiza esta mensagem como "Activity Item" compacto
 * (ver `chat-window.tsx`); este texto é o fallback/legenda.
 */
export function buildConversationTimelineCallRecordingContent(params: {
  callId: string;
  direction: string;
  agentName?: string;
  startDate: Date | null;
  endDate: Date;
  durationSec: number | null;
  terminateStatus: string;
  hasRecordingUrl: boolean;
}): string {
  const hmS = params.startDate ? formatCallHm(params.startDate) : null;
  const hmE = formatCallHm(params.endDate);
  const dirLabel = params.direction === "USER_INITIATED" ? "entrada" : "saída";
  const durShort =
    params.durationSec != null && params.durationSec > 0
      ? params.durationSec >= 60
        ? `${Math.floor(params.durationSec / 60)}m${String(params.durationSec % 60).padStart(2, "0")}s`
        : `${params.durationSec}s`
      : null;
  const spanShort = hmS ? `${hmS}–${hmE}` : hmE;
  const pieces = [
    `Chamada · ${dirLabel}`,
    durShort ? `· ${durShort}` : null,
    `· ${spanShort}`,
  ].filter(Boolean);
  return pieces.join(" ");
}
