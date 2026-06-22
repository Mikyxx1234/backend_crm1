/**
 * Adapter de webhooks Api4com — `channel-answer` e `channel-hangup`.
 *
 * Doc: https://developers.api4com.com/integration-api4com-webphone.html
 *
 * Idempotência: a chave é `(providerCallId, eventKind)`. O mesmo evento pode
 * rechegar; o pipeline em `services/calls.ts` faz upsert em `Call` e cria
 * `CallEvent` bruto sempre.
 *
 * Metadata CRM: a Api4com ecoa o `metadata` enviado no `POST /dialer`. O CRM
 * envia `{ gateway, crm_user_id, deal_id, contact_id }` (snake_case por
 * convenção do PBX) — extraímos aqui para preencher `Call.contactId` e emitir
 * `ActivityEvent` com `dealId` na timeline do negócio.
 *
 * Versão: a documentação cita `1.8`, exemplos usam `v1.4`. O adapter aceita
 * ambos transparentemente — a versão é um campo de auditoria, não influencia
 * o parsing.
 */

import type { CallProviderConfig } from "@prisma/client";

import type {
  CallAdapter,
  CallCrmMetadata,
  CallEventKind,
  NormalizedCallEvent,
} from "./types";

type Api4ComWebhookPayload = {
  /** ID real da chamada (NÃO confundir com `id` do /dialer). */
  id?: string;
  /** Tipo do evento — `channel-answer` | `channel-hangup`. */
  eventType?: string;
  /** Versão do payload — `"1.8"` ou `"v1.4"`. */
  version?: string;

  direction?: string;
  caller?: string;
  called?: string;

  startedAt?: string;
  answeredAt?: string;
  endedAt?: string;
  duration?: number;

  hangupCause?: string;
  hangupCauseCode?: string;
  recordUrl?: string;

  /** Metadata ecoada do /dialer. */
  metadata?: Record<string, unknown>;
};

function parseApi4ComTimestamp(raw: string | undefined): string {
  if (!raw) return new Date().toISOString();
  const isoLike = raw.includes("T") ? raw : raw.replace(" ", "T");
  const d = new Date(isoLike);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function mapHangupStatus(payload: Api4ComWebhookPayload): NormalizedCallEvent["status"] {
  const cause = (payload.hangupCause ?? "").toUpperCase();
  const answered = Boolean(payload.answeredAt?.trim());
  const duration = typeof payload.duration === "number" ? payload.duration : 0;

  if (cause.includes("BUSY") || cause.includes("USER_BUSY")) return "BUSY";
  if (cause.includes("NO_ANSWER") || cause.includes("NO_USER_RESPONSE")) return "MISSED";
  if (!answered && duration <= 0) return "MISSED";
  if (cause.includes("FAIL") || cause.includes("ERROR")) return "FAILED";
  return "COMPLETED";
}

function classifyEventKind(eventType: string | undefined): CallEventKind {
  const t = (eventType ?? "").toLowerCase();
  if (t === "channel-answer") return "ANSWERED";
  if (t === "channel-hangup") return "HANGUP";
  if (t === "channel-ringing" || t === "channel-progress") return "RINGING";
  return "OTHER";
}

function safeString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s : undefined;
}

/**
 * Extrai os IDs CRM do `metadata` ecoado pelo PBX.
 *
 * Aceita tanto `snake_case` (convenção Api4com) quanto `camelCase` (defensivo,
 * para o caso de algum proxy reformatar a payload). NÃO confia no formato.
 */
export function extractCrmMetadata(rawPayload: unknown): CallCrmMetadata {
  if (!rawPayload || typeof rawPayload !== "object") return {};
  const meta = (rawPayload as { metadata?: unknown }).metadata;
  if (!meta || typeof meta !== "object") return {};
  const m = meta as Record<string, unknown>;

  return {
    gateway: safeString(m.gateway),
    crmUserId: safeString(m.crm_user_id ?? m.crmUserId),
    dealId: safeString(m.deal_id ?? m.dealId),
    contactId: safeString(m.contact_id ?? m.contactId),
  };
}

export const api4comAdapter: CallAdapter = {
  normalize(rawPayload: unknown, _config: CallProviderConfig): NormalizedCallEvent {
    const p = (rawPayload ?? {}) as Api4ComWebhookPayload;

    const providerCallId = p.id?.trim();
    if (!providerCallId) {
      throw new Error("[api4com] Campo id ausente no webhook.");
    }

    const dir = (p.direction ?? "").toLowerCase();
    const direction: NormalizedCallEvent["direction"] =
      dir === "inbound" ? "INBOUND" : "OUTBOUND";

    const caller = String(p.caller ?? "").trim();
    const called = String(p.called ?? "").trim();
    const from = caller || called;
    const to = called || caller;

    const eventKind = classifyEventKind(p.eventType);

    let status: NormalizedCallEvent["status"];
    let timestamp: string;

    if (eventKind === "ANSWERED") {
      status = "ANSWERED";
      timestamp = parseApi4ComTimestamp(p.answeredAt ?? p.startedAt);
    } else if (eventKind === "HANGUP") {
      status = mapHangupStatus(p);
      timestamp = parseApi4ComTimestamp(p.endedAt ?? p.answeredAt ?? p.startedAt);
    } else if (eventKind === "RINGING") {
      status = "RINGING";
      timestamp = parseApi4ComTimestamp(p.startedAt);
    } else {
      // Evento desconhecido — registra como hangup defensivo (mantém comportamento
      // anterior do adapter, que só cobria channel-hangup).
      status = mapHangupStatus(p);
      timestamp = parseApi4ComTimestamp(p.endedAt ?? p.startedAt);
    }

    const crmMetadata = extractCrmMetadata(rawPayload);

    return {
      providerCallId,
      direction,
      from,
      to,
      status,
      timestamp,
      recordingUrl: p.recordUrl?.trim() || undefined,
      eventKind,
      crmMetadata,
      durationSeconds:
        typeof p.duration === "number" && p.duration >= 0 ? p.duration : undefined,
      hangupCause: safeString(p.hangupCause),
    };
  },
};
