/**
 * Testes unitários do adapter generic-sip.
 * Funções puras (normalize + getByPath) — sem mocks, sem IO.
 *
 * Configuração de exemplo usada nos testes:
 *   fieldMappings.providerCallId → "data.call_id"
 *   fieldMappings.from           → "data.from"
 *   fieldMappings.to             → "data.to"
 *   fieldMappings.status         → "data.state"
 *   fieldMappings.timestamp      → "data.ts"
 *   fieldMappings.recordingUrl   → "data.rec_url"
 *   fieldMappings.statusMap:
 *     "ringing"   → RINGING
 *     "answered"  → ANSWERED
 *     "hangup"    → COMPLETED
 *     "no-answer" → MISSED
 */
import { describe, expect, it } from "vitest";

import type { CallProviderConfig } from "@prisma/client";

import { genericSipAdapter, getByPath } from "@/services/call-adapters/generic-sip";

// ── helpers ───────────────────────────────────────────────────────────────

/** Cria um CallProviderConfig mínimo para os testes. */
function makeConfig(fieldMappings: Record<string, unknown>): CallProviderConfig {
  return {
    id: "cfg-test",
    organizationId: "org-test",
    providerKey: "generic-sip",
    fieldMappings,
    authMode: "TOKEN",
    webhookSecretEncrypted: "",
    signatureHeader: null,
    webhookToken: "tok-test",
    recordingDelivery: "URL",
    createContactsForCalls: false,
    isActive: true,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  } as unknown as CallProviderConfig;
}

/** fieldMappings com payload aninhado em "data.*" e statusMap configurado. */
const NESTED_MAPPINGS: Record<string, unknown> = {
  providerCallId: "data.call_id",
  from: "data.from",
  to: "data.to",
  status: "data.state",
  timestamp: "data.ts",
  recordingUrl: "data.rec_url",
  statusMap: {
    ringing: "RINGING",
    answered: "ANSWERED",
    hangup: "COMPLETED",
    "no-answer": "MISSED",
  },
};

// ── getByPath ─────────────────────────────────────────────────────────────

describe("getByPath", () => {
  it("acessa campo de nível raiz", () => {
    expect(getByPath({ call_id: "abc" }, "call_id")).toBe("abc");
  });

  it("acessa campo aninhado (dot-notation)", () => {
    expect(getByPath({ data: { call_id: "abc" } }, "data.call_id")).toBe("abc");
  });

  it("acessa três níveis", () => {
    expect(getByPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
  });

  it("retorna undefined para caminho inexistente", () => {
    expect(getByPath({ a: 1 }, "a.b")).toBeUndefined();
    expect(getByPath({ a: 1 }, "x")).toBeUndefined();
  });

  it("retorna undefined para path vazio", () => {
    expect(getByPath({ a: 1 }, "")).toBeUndefined();
  });

  it("retorna undefined para objeto null", () => {
    expect(getByPath(null, "a")).toBeUndefined();
  });

  it("retorna undefined para objeto undefined", () => {
    expect(getByPath(undefined, "a")).toBeUndefined();
  });

  it("interrompe quando segmento intermediário não é objeto", () => {
    expect(getByPath({ a: "string" }, "a.b")).toBeUndefined();
  });
});

// ── genericSipAdapter.normalize — mapeamento com fieldMappings ────────────

describe("genericSipAdapter.normalize — payload aninhado", () => {
  const config = makeConfig(NESTED_MAPPINGS);

  it("mapeia todos os campos corretamente", () => {
    const payload = {
      data: {
        call_id: "call-abc-123",
        from: "+5511987654321",
        to: "+5521987654321",
        state: "answered",
        ts: "2025-01-15T10:00:00.000Z",
        rec_url: "https://storage.example.com/rec.wav",
      },
    };

    const result = genericSipAdapter.normalize(payload, config);

    expect(result.providerCallId).toBe("call-abc-123");
    expect(result.from).toBe("+5511987654321");
    expect(result.to).toBe("+5521987654321");
    expect(result.status).toBe("ANSWERED");
    expect(result.timestamp).toBe("2025-01-15T10:00:00.000Z");
    expect(result.recordingUrl).toBe("https://storage.example.com/rec.wav");
  });

  it("mapeia 'answered' → ANSWERED via statusMap", () => {
    const payload = { data: { call_id: "c1", from: "a", to: "b", state: "answered", ts: "" } };
    expect(genericSipAdapter.normalize(payload, config).status).toBe("ANSWERED");
  });

  it("mapeia 'hangup' → COMPLETED via statusMap", () => {
    const payload = { data: { call_id: "c1", from: "a", to: "b", state: "hangup", ts: "" } };
    expect(genericSipAdapter.normalize(payload, config).status).toBe("COMPLETED");
  });

  it("mapeia 'no-answer' → MISSED via statusMap", () => {
    const payload = { data: { call_id: "c1", from: "a", to: "b", state: "no-answer", ts: "" } };
    expect(genericSipAdapter.normalize(payload, config).status).toBe("MISSED");
  });

  it("mapeia 'ringing' → RINGING via statusMap", () => {
    const payload = { data: { call_id: "c1", from: "a", to: "b", state: "ringing", ts: "" } };
    expect(genericSipAdapter.normalize(payload, config).status).toBe("RINGING");
  });

  it("campo recordingUrl ausente → undefined (sem crash)", () => {
    const payload = { data: { call_id: "c1", from: "a", to: "b", state: "ringing", ts: "" } };
    const result = genericSipAdapter.normalize(payload, config);
    expect(result.recordingUrl).toBeUndefined();
  });

  it("recordingUrl string vazia → undefined", () => {
    const payload = {
      data: { call_id: "c1", from: "a", to: "b", state: "ringing", ts: "", rec_url: "  " },
    };
    expect(genericSipAdapter.normalize(payload, config).recordingUrl).toBeUndefined();
  });
});

// ── direção inbound / outbound ────────────────────────────────────────────

describe("genericSipAdapter.normalize — direção", () => {
  it("direção INBOUND como default quando campo ausente", () => {
    const config = makeConfig(NESTED_MAPPINGS);
    const payload = { data: { call_id: "c1", from: "a", to: "b", state: "ringing", ts: "" } };
    expect(genericSipAdapter.normalize(payload, config).direction).toBe("INBOUND");
  });

  it("mapeia OUTBOUND quando campo configurado e presente", () => {
    const config = makeConfig({ ...NESTED_MAPPINGS, direction: "data.dir" });
    const payload = {
      data: { call_id: "c1", from: "a", to: "b", state: "ringing", ts: "", dir: "OUTBOUND" },
    };
    expect(genericSipAdapter.normalize(payload, config).direction).toBe("OUTBOUND");
  });

  it("mapeia variante 'outgoing' → OUTBOUND", () => {
    const config = makeConfig({ ...NESTED_MAPPINGS, direction: "data.dir" });
    const payload = {
      data: { call_id: "c1", from: "a", to: "b", state: "ringing", ts: "", dir: "outgoing" },
    };
    expect(genericSipAdapter.normalize(payload, config).direction).toBe("OUTBOUND");
  });
});

// ── timestamp ─────────────────────────────────────────────────────────────

describe("genericSipAdapter.normalize — timestamp", () => {
  const config = makeConfig(NESTED_MAPPINGS);

  it("ISO 8601 preservado como-está", () => {
    const ts = "2025-01-15T10:00:00.000Z";
    const payload = { data: { call_id: "c1", from: "a", to: "b", state: "ringing", ts } };
    expect(genericSipAdapter.normalize(payload, config).timestamp).toBe(ts);
  });

  it("unix epoch em segundos → ISO 8601", () => {
    // 1705312800s = 2024-01-15T10:00:00.000Z
    const payload = {
      data: { call_id: "c1", from: "a", to: "b", state: "ringing", ts: "1705312800" },
    };
    const result = genericSipAdapter.normalize(payload, config);
    expect(result.timestamp).toBe(new Date(1705312800 * 1000).toISOString());
  });

  it("timestamp ausente → ISO atual (não vazio, não crash)", () => {
    const payload = { data: { call_id: "c1", from: "a", to: "b", state: "ringing", ts: "" } };
    const before = Date.now();
    const result = genericSipAdapter.normalize(payload, config);
    const after = Date.now();
    const ts = new Date(result.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ── fallback sem fieldMappings (defaults de nível raiz) ───────────────────

describe("genericSipAdapter.normalize — sem fieldMappings (defaults)", () => {
  it("usa campos de nível raiz como default", () => {
    const config = makeConfig({});
    const payload = {
      call_id: "c-default",
      from: "+5511987654321",
      to: "+5521000000000",
      status: "RINGING",
      timestamp: "2025-01-01T00:00:00.000Z",
    };

    const result = genericSipAdapter.normalize(payload, config);
    expect(result.providerCallId).toBe("c-default");
    expect(result.from).toBe("+5511987654321");
    expect(result.to).toBe("+5521000000000");
    expect(result.status).toBe("RINGING");
    expect(result.timestamp).toBe("2025-01-01T00:00:00.000Z");
  });
});

// ── erros ─────────────────────────────────────────────────────────────────

describe("genericSipAdapter.normalize — erros", () => {
  it("lança erro quando providerCallId está ausente", () => {
    const config = makeConfig(NESTED_MAPPINGS);
    const payload = { data: { from: "a", to: "b", state: "ringing", ts: "" } };
    expect(() => genericSipAdapter.normalize(payload, config)).toThrow(/providerCallId ausente/);
  });

  it("não lança erro quando campos from/to estão vazios (string vazia)", () => {
    const config = makeConfig(NESTED_MAPPINGS);
    const payload = { data: { call_id: "c1", from: "", to: "", state: "ringing", ts: "" } };
    expect(() => genericSipAdapter.normalize(payload, config)).not.toThrow();
  });
});
