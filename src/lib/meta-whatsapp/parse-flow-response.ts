/**
 * Extrai e formata payload de respostas WhatsApp Flow (nfm_reply / flow_reply).
 */

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function sanitizeFlowFieldKey(key: string): string {
  return key.trim().replace(/[^a-zA-Z0-9_]/g, "_") || "campo";
}

/** Parseia `response_json` do webhook Meta em objeto de campos. */
export function parseWhatsappFlowResponsePayload(
  nfm: Record<string, unknown>,
): { payload: Record<string, unknown>; flowToken: string | null; flowMetaName: string | null } | null {
  const rawJson = nfm.response_json;
  let payload: Record<string, unknown> | null = null;

  if (typeof rawJson === "string" && rawJson.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  } else if (rawJson && typeof rawJson === "object" && !Array.isArray(rawJson)) {
    payload = rawJson as Record<string, unknown>;
  }

  if (!payload) return null;

  const flowToken =
    typeof payload.flow_token === "string" && payload.flow_token.trim()
      ? payload.flow_token.trim()
      : null;

  const entries = Object.fromEntries(
    Object.entries(payload).filter(([k]) => k !== "flow_token" && !k.startsWith("__")),
  );

  if (Object.keys(entries).length === 0) return null;

  return {
    payload: entries,
    flowToken,
    flowMetaName: str(nfm.name) || null,
  };
}

export function formatWhatsappFlowResponse(nfm: Record<string, unknown>): string | null {
  const parsed = parseWhatsappFlowResponsePayload(nfm);
  if (!parsed) return null;

  const formatKey = (k: string): string => {
    if (/\s/.test(k) || /[A-Z]/.test(k)) return k;
    const words = k.replace(/[_-]+/g, " ").trim();
    if (!words) return k;
    return words.charAt(0).toUpperCase() + words.slice(1);
  };

  const formatVal = (v: unknown): string => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "boolean") return v ? "Sim" : "Não";
    if (typeof v === "number") return String(v);
    if (Array.isArray(v)) {
      const joined = v.map((item) => formatVal(item)).join(", ");
      return joined.length > 200 ? `${joined.slice(0, 200)}…` : joined;
    }
    if (typeof v === "object") {
      const json = JSON.stringify(v);
      return json.length > 200 ? `${json.slice(0, 200)}…` : json;
    }
    const s = String(v);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  };

  const flowName = parsed.flowMetaName;
  const header = flowName
    ? `📋 Resposta do formulário (${flowName})`
    : `📋 Resposta do formulário`;

  const lines = Object.entries(parsed.payload).map(
    ([k, v]) => `• ${formatKey(k)}: ${formatVal(v)}`,
  );
  const full = `${header}\n${lines.join("\n")}`;
  return full.length > 1000 ? `${full.slice(0, 1000)}…` : full;
}
