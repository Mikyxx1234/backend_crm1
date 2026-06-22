/**
 * Adapter "generic-sip" — dirigido por configuração (fieldMappings).
 *
 * fieldMappings (CallProviderConfig.fieldMappings) deve ser um objeto:
 * {
 *   providerCallId: "data.call_id",       // caminho no payload (dot-notation)
 *   direction:      "data.direction",
 *   from:           "data.caller",
 *   to:             "data.callee",
 *   status:         "data.state",
 *   timestamp:      "data.start_time",
 *   recordingUrl:   "data.recording_url", // opcional
 *   statusMap: {                           // provedor -> CallStatus
 *     "ringing":   "RINGING",
 *     "answered":  "ANSWERED",
 *     "completed": "COMPLETED",
 *     "missed":    "MISSED",
 *     "busy":      "BUSY",
 *     "failed":    "FAILED"
 *   }
 * }
 *
 * Defaults usados quando um caminho não estiver mapeado:
 *   providerCallId → "call_id"
 *   direction      → "direction"
 *   from           → "from"
 *   to             → "to"
 *   status         → "status"
 *   timestamp      → "timestamp"
 */

import type { CallProviderConfig } from "@prisma/client";

import type { CallAdapter, NormalizedCallEvent } from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Acessa um campo de um objeto usando dot-notation (ex.: "data.call_id").
 * Retorna undefined se qualquer segmento estiver ausente.
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path || obj === null || obj === undefined) return undefined;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

type Mappings = {
  providerCallId?: string;
  direction?: string;
  from?: string;
  to?: string;
  status?: string;
  timestamp?: string;
  recordingUrl?: string;
  statusMap?: Record<string, string>;
};

const VALID_STATUSES = new Set(["RINGING", "ANSWERED", "COMPLETED", "MISSED", "BUSY", "FAILED"]);

function resolveStatus(
  raw: unknown,
  statusMap: Record<string, string> | undefined,
): NormalizedCallEvent["status"] {
  const str = String(raw ?? "").toUpperCase();

  // Tenta mapa configurado primeiro (case-insensitive na chave)
  if (statusMap) {
    const lower = String(raw ?? "").toLowerCase();
    const mapped = statusMap[lower] ?? statusMap[str];
    if (mapped && VALID_STATUSES.has(mapped.toUpperCase())) {
      return mapped.toUpperCase() as NormalizedCallEvent["status"];
    }
  }

  // Fallback: valor já está no formato esperado
  if (VALID_STATUSES.has(str)) return str as NormalizedCallEvent["status"];

  // Heurísticas comuns de provedor
  if (str.includes("RING")) return "RINGING";
  if (str.includes("ANSWER") || str.includes("ACTIVE")) return "ANSWERED";
  if (str.includes("COMPLET") || str.includes("HANGUP") || str.includes("END")) return "COMPLETED";
  if (str.includes("MISS") || str.includes("NO_ANSWER") || str.includes("NOANSWER")) return "MISSED";
  if (str.includes("BUSY")) return "BUSY";

  return "FAILED";
}

function resolveDirection(raw: unknown): NormalizedCallEvent["direction"] {
  const str = String(raw ?? "").toUpperCase();
  if (str === "INBOUND" || str === "IN" || str === "INCOMING") return "INBOUND";
  if (str === "OUTBOUND" || str === "OUT" || str === "OUTGOING") return "OUTBOUND";
  return "INBOUND"; // default seguro
}

// ── Adapter ───────────────────────────────────────────────────────────────

export const genericSipAdapter: CallAdapter = {
  normalize(rawPayload: unknown, config: CallProviderConfig): NormalizedCallEvent {
    const mappings = (config.fieldMappings ?? {}) as Mappings;

    const get = (field: keyof Omit<Mappings, "statusMap">, defaultPath: string): unknown =>
      getByPath(rawPayload, mappings[field] ?? defaultPath);

    const providerCallId = String(get("providerCallId", "call_id") ?? "");
    if (!providerCallId) {
      throw new Error(
        `[generic-sip] providerCallId ausente. Verifique fieldMappings.providerCallId (payload: ${JSON.stringify(rawPayload).slice(0, 200)})`,
      );
    }

    const direction = resolveDirection(get("direction", "direction"));
    const from = String(get("from", "from") ?? "");
    const to = String(get("to", "to") ?? "");
    const rawStatus = get("status", "status");
    const status = resolveStatus(rawStatus, mappings.statusMap);

    let timestamp = String(get("timestamp", "timestamp") ?? "");
    if (!timestamp) {
      timestamp = new Date().toISOString();
    } else if (!isNaN(Number(timestamp))) {
      // Unix epoch (segundos ou ms)
      const num = Number(timestamp);
      timestamp = new Date(num < 1e12 ? num * 1000 : num).toISOString();
    }

    const recordingUrlRaw = get("recordingUrl", "recording_url");
    const recordingUrl =
      recordingUrlRaw && typeof recordingUrlRaw === "string" && recordingUrlRaw.trim()
        ? recordingUrlRaw.trim()
        : undefined;

    return { providerCallId, direction, from, to, status, timestamp, recordingUrl };
  },
};
