/**
 * Testes de integração de processWebhookEvent (calls.ts).
 *
 * Módulos mockados (vi.mock):
 *  - @/lib/prisma            → prisma client em memória (callEvent + call)
 *  - @/lib/auth-helpers      → withResolvedContext executa o handler diretamente
 *  - @/lib/prisma-helpers    → withOrg apenas faz spread + organizationId
 *  - @/lib/logger            → no-op
 *  - @/lib/storage/local     → no-op (sem IO real)
 *  - @/services/contacts     → getContacts / createContact controláveis por teste
 *  - @/services/call-provider-configs → findConfigByWebhookToken / decryptWebhookSecret
 *
 * NÃO mockado:
 *  - @/lib/phone             → usa implementação real (normalizePhone)
 *  - @/services/call-adapters → usa o adapter real (generic-sip) para testes end-to-end
 */
import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock store (vi.hoisted para inicialização antes dos imports) ───────────

const { store, prismaMock, getContactsMock, createContactMock, findConfigMock } = vi.hoisted(() => {
  type CallRecord = {
    id: string;
    organizationId: string;
    provider: string;
    providerCallId: string;
    direction: string;
    status: string;
    fromNumber: string;
    toNumber: string;
    startedAt?: Date;
    answeredAt?: Date | null;
    endedAt?: Date | null;
    durationSeconds?: number | null;
    contactId: string | null;
    recordingUrl: string | null;
  };

  type CallEventRecord = {
    id: string;
    organizationId: string;
    provider: string;
    rawPayload: unknown;
    receivedAt: Date;
    callId: string | null;
  };

  const store: {
    calls: Map<string, CallRecord>;
    callEvents: Map<string, CallEventRecord>;
    seq: number;
  } = { calls: new Map(), callEvents: new Map(), seq: 0 };

  const prismaMock = {
    callEvent: {
      async create(args: { data: Record<string, unknown>; select: unknown }) {
        store.seq += 1;
        const id = `evt_${store.seq}`;
        store.callEvents.set(id, {
          id,
          organizationId: args.data.organizationId as string,
          provider: args.data.provider as string,
          rawPayload: args.data.rawPayload,
          receivedAt: args.data.receivedAt as Date,
          callId: null,
        });
        return { id };
      },
      async update(args: { where: { id: string }; data: Record<string, unknown> }) {
        const evt = store.callEvents.get(args.where.id);
        if (evt) {
          if (args.data.callId) evt.callId = args.data.callId as string;
        }
        return { id: args.where.id };
      },
    },
    call: {
      async findUnique(args: {
        where: { id?: string; organizationId_provider_providerCallId?: { organizationId: string; provider: string; providerCallId: string } };
        select: unknown;
      }) {
        if (args.where.id) return store.calls.get(args.where.id) ?? null;
        if (args.where.organizationId_provider_providerCallId) {
          const { organizationId, provider, providerCallId } =
            args.where.organizationId_provider_providerCallId;
          for (const c of store.calls.values()) {
            if (
              c.organizationId === organizationId &&
              c.provider === provider &&
              c.providerCallId === providerCallId
            ) {
              return c;
            }
          }
        }
        return null;
      },
      async create(args: { data: Record<string, unknown>; select: unknown }) {
        store.seq += 1;
        const id = `call_${store.seq}`;
        const record: CallRecord = {
          id,
          organizationId: args.data.organizationId as string,
          provider: args.data.provider as string,
          providerCallId: args.data.providerCallId as string,
          direction: args.data.direction as string,
          status: args.data.status as string,
          fromNumber: args.data.fromNumber as string,
          toNumber: args.data.toNumber as string,
          startedAt: args.data.startedAt as Date | undefined,
          answeredAt: (args.data.answeredAt as Date | undefined) ?? null,
          endedAt: (args.data.endedAt as Date | undefined) ?? null,
          durationSeconds: (args.data.durationSeconds as number | undefined) ?? null,
          contactId: (args.data.contactId as string | undefined) ?? null,
          recordingUrl: (args.data.recordingUrl as string | undefined) ?? null,
        };
        store.calls.set(id, record);
        return { id, contactId: record.contactId, recordingUrl: record.recordingUrl };
      },
      async update(args: {
        where: { id: string };
        data: Record<string, unknown>;
        select?: unknown;
      }) {
        const call = store.calls.get(args.where.id);
        if (!call) throw new Error(`[mock] call ${args.where.id} não encontrado`);
        if (args.data.status !== undefined) call.status = args.data.status as string;
        if (args.data.answeredAt !== undefined)
          call.answeredAt = args.data.answeredAt as Date | null;
        if (args.data.endedAt !== undefined) call.endedAt = args.data.endedAt as Date | null;
        if (args.data.durationSeconds !== undefined)
          call.durationSeconds = args.data.durationSeconds as number | null;
        if (args.data.contactId !== undefined) call.contactId = args.data.contactId as string;
        if (args.data.recordingUrl !== undefined)
          call.recordingUrl = args.data.recordingUrl as string;
        return { id: call.id, contactId: call.contactId, recordingUrl: call.recordingUrl };
      },
    },
  };

  // Spies controláveis por cada teste
  const getContactsMock = vi.fn(async () => ({ items: [] as { id: string }[], total: 0 }));
  const createContactMock = vi.fn(async ({ phone }: { phone: string }) => ({
    id: `contact_auto_${phone}`,
  }));
  const findConfigMock = vi.fn(async (_token: string) => null as unknown);

  return { store, prismaMock, getContactsMock, createContactMock, findConfigMock };
});

// ── Mocks de módulo ───────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

vi.mock("@/lib/auth-helpers", () => ({
  withResolvedContext: <T>(_ctx: unknown, handler: () => Promise<T>) => handler(),
}));

vi.mock("@/lib/prisma-helpers", () => ({
  withOrg: (data: Record<string, unknown>, orgId: string) => ({ ...data, organizationId: orgId }),
}));

vi.mock("@/lib/logger", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@/lib/storage/local", () => ({
  generateFileName: vi.fn(() => "mock_file.wav"),
  saveFile: vi.fn(async () => ({ url: "https://cdn.example.com/mock_file.wav" })),
}));

vi.mock("@/services/contacts", () => ({
  get getContacts() {
    return getContactsMock;
  },
  get createContact() {
    return createContactMock;
  },
}));

vi.mock("@/services/call-provider-configs", () => ({
  get findConfigByWebhookToken() {
    return findConfigMock;
  },
  decryptWebhookSecret: (_cfg: { webhookSecretEncrypted: string }) => "plain-secret",
}));

// ── Import do SUT (depois dos mocks) ─────────────────────────────────────

import { processWebhookEvent } from "@/services/calls";

// ── Fixtures ──────────────────────────────────────────────────────────────

const BASE_CONFIG = {
  id: "cfg-1",
  organizationId: "org-1",
  providerKey: "generic-sip",
  fieldMappings: {
    providerCallId: "data.call_id",
    from: "data.from",
    to: "data.to",
    status: "data.state",
    timestamp: "data.ts",
    statusMap: {
      ringing: "RINGING",
      answered: "ANSWERED",
      hangup: "COMPLETED",
      "no-answer": "MISSED",
    },
  },
  authMode: "TOKEN" as const,
  webhookSecretEncrypted: "enc:plain-secret",
  signatureHeader: "x-webhook-sig",
  webhookToken: "valid-token-abc",
  recordingDelivery: "URL" as const,
  createContactsForCalls: false,
  isActive: true,
};

/** Payload bruto de um evento RINGING. */
function ringPayload(callId = "call-001", from = "+5511987654321", to = "+5521000000001") {
  return {
    data: { call_id: callId, from, to, state: "ringing", ts: new Date().toISOString() },
  };
}

/** Payload ANSWERED. */
function answerPayload(callId = "call-001") {
  return { data: { call_id: callId, from: "+5511987654321", to: "+5521000000001", state: "answered", ts: new Date().toISOString() } };
}

/** Payload COMPLETED (hangup). */
function completedPayload(callId = "call-001") {
  return { data: { call_id: callId, from: "+5511987654321", to: "+5521000000001", state: "hangup", ts: new Date(Date.now() + 30_000).toISOString() } };
}

// ── Helpers de HMAC ───────────────────────────────────────────────────────

function makeHmacSig(body: string, secret = "plain-secret") {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

// ── Reset ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  store.calls.clear();
  store.callEvents.clear();
  store.seq = 0;
  getContactsMock.mockReset();
  getContactsMock.mockResolvedValue({ items: [], total: 0 });
  createContactMock.mockReset();
  createContactMock.mockResolvedValue({ id: "contact-auto-1" });
  findConfigMock.mockReset();
  findConfigMock.mockResolvedValue(null);
});

// ── Testes ────────────────────────────────────────────────────────────────

describe("processWebhookEvent — autenticação", () => {
  it("token inválido (config não encontrado) → { ok:false, reason:'token_not_found_or_inactive' }", async () => {
    findConfigMock.mockResolvedValue(null);

    const result = await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "bad-token",
      rawPayload: {},
    });

    expect(result).toEqual({ ok: false, reason: "token_not_found_or_inactive" });
    expect(store.calls.size).toBe(0);
  });

  it("config inativo → { ok:false, reason:'token_not_found_or_inactive' }", async () => {
    findConfigMock.mockResolvedValue({ ...BASE_CONFIG, isActive: false });

    const result = await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: ringPayload(),
    });

    expect(result).toEqual({ ok: false, reason: "token_not_found_or_inactive" });
  });

  it("HMAC inválido → { ok:false, reason:'hmac_invalid' }", async () => {
    findConfigMock.mockResolvedValue({ ...BASE_CONFIG, authMode: "HMAC" as const });
    const body = JSON.stringify(ringPayload());

    const result = await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: ringPayload(),
      rawBody: body,
      signatureHeader: "sha256=badassinatura00000000000000000000000000000000000000000000000000",
    });

    expect(result).toEqual({ ok: false, reason: "hmac_invalid" });
  });

  it("HMAC válido → { ok:true }", async () => {
    findConfigMock.mockResolvedValue({ ...BASE_CONFIG, authMode: "HMAC" as const });
    const payload = ringPayload("call-hmac");
    const body = JSON.stringify(payload);

    const result = await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: payload,
      rawBody: body,
      signatureHeader: makeHmacSig(body),
    });

    expect(result.ok).toBe(true);
  });

  it("HMAC com header ausente → { ok:false, reason:'hmac_signature_missing' }", async () => {
    findConfigMock.mockResolvedValue({ ...BASE_CONFIG, authMode: "HMAC" as const });

    const result = await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: ringPayload(),
      // sem signatureHeader nem rawBody
    });

    expect(result).toEqual({ ok: false, reason: "hmac_signature_missing" });
  });
});

describe("processWebhookEvent — criação e idempotência do Call", () => {
  beforeEach(() => {
    findConfigMock.mockResolvedValue(BASE_CONFIG);
  });

  it("evento RINGING cria Call com status RINGING", async () => {
    const result = await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: ringPayload("call-ringing-1"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const call = store.calls.get(result.callId);
    expect(call).toBeDefined();
    expect(call!.status).toBe("RINGING");
    expect(call!.providerCallId).toBe("call-ringing-1");
    expect(call!.organizationId).toBe("org-1");
  });

  it("evento RINGING cria CallEvent vinculado ao Call", async () => {
    const result = await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: ringPayload("call-ev-link"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const evt = store.callEvents.get(result.callEventId);
    expect(evt).toBeDefined();
    expect(evt!.callId).toBe(result.callId);
  });

  it("sequência RINGING→ANSWERED→COMPLETED atualiza o MESMO Call sem duplicar", async () => {
    const callId = "call-lifecycle";

    // RINGING
    const r1 = await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: ringPayload(callId),
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const internalCallId = r1.callId;

    // ANSWERED
    const r2 = await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: answerPayload(callId),
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.callId).toBe(internalCallId); // mesmo call

    // COMPLETED
    const r3 = await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: completedPayload(callId),
    });
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.callId).toBe(internalCallId); // ainda o mesmo call

    // Só 1 Call no store
    expect(store.calls.size).toBe(1);

    const call = store.calls.get(internalCallId)!;
    expect(call.status).toBe("COMPLETED");
    expect(call.answeredAt).toBeDefined();
    expect(call.endedAt).toBeDefined();
  });

  it("sequência RINGING→ANSWERED→COMPLETED calcula durationSeconds", async () => {
    const callId = "call-duration";
    const answeredAt = new Date("2025-01-15T10:00:00.000Z");
    const endedAt = new Date("2025-01-15T10:00:45.000Z"); // 45s depois

    await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: ringPayload(callId),
    });

    // ANSWERED com timestamp controlado
    await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: {
        data: {
          call_id: callId,
          from: "+5511987654321",
          to: "+5521000000001",
          state: "answered",
          ts: answeredAt.toISOString(),
        },
      },
    });

    // COMPLETED com timestamp controlado (45s depois)
    await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: {
        data: {
          call_id: callId,
          from: "+5511987654321",
          to: "+5521000000001",
          state: "hangup",
          ts: endedAt.toISOString(),
        },
      },
    });

    const [call] = [...store.calls.values()];
    expect(call.durationSeconds).toBe(45);
  });

  it("REENVIO do mesmo evento (idempotência) NÃO duplica Call", async () => {
    const payload = ringPayload("call-idem");

    const r1 = await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: payload,
    });
    const r2 = await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: payload,
    });

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    // Mesmo callId retornado
    expect(r2.callId).toBe(r1.callId);
    // Apenas 1 Call no store
    expect(store.calls.size).toBe(1);
  });

  it("MISSED cria Call com status MISSED", async () => {
    const result = await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: {
        data: {
          call_id: "call-missed",
          from: "+5511987654321",
          to: "+5521000000001",
          state: "no-answer",
          ts: new Date().toISOString(),
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(store.calls.get(result.callId)!.status).toBe("MISSED");
  });
});

describe("processWebhookEvent — vínculo a contato", () => {
  beforeEach(() => {
    findConfigMock.mockResolvedValue(BASE_CONFIG);
  });

  it("quando phone casa com Contact existente, seta contactId", async () => {
    const existingContact = { id: "contact-existing-1" };
    getContactsMock.mockResolvedValue({ items: [existingContact], total: 1 });

    const result = await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: ringPayload("call-contact-match", "+5511987654321"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const call = store.calls.get(result.callId)!;
    expect(call.contactId).toBe("contact-existing-1");
  });

  it("createContactsForCalls=false e phone sem match → não cria contato", async () => {
    getContactsMock.mockResolvedValue({ items: [], total: 0 });
    findConfigMock.mockResolvedValue({ ...BASE_CONFIG, createContactsForCalls: false });

    const result = await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: ringPayload("call-no-contact", "+5511000000000"),
    });

    expect(result.ok).toBe(true);
    expect(createContactMock).not.toHaveBeenCalled();
    if (!result.ok) return;
    expect(store.calls.get(result.callId)!.contactId).toBeNull();
  });

  it("createContactsForCalls=true e phone sem match → cria contato e vincula", async () => {
    getContactsMock.mockResolvedValue({ items: [], total: 0 });
    createContactMock.mockResolvedValue({ id: "contact-created-1" });
    findConfigMock.mockResolvedValue({ ...BASE_CONFIG, createContactsForCalls: true });

    const result = await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: ringPayload("call-auto-contact", "+5511987654321"),
    });

    expect(result.ok).toBe(true);
    expect(createContactMock).toHaveBeenCalledOnce();
    if (!result.ok) return;
    expect(store.calls.get(result.callId)!.contactId).toBe("contact-created-1");
  });

  it("createContactsForCalls=true mas createContact lança erro → continua sem vínculo", async () => {
    getContactsMock.mockResolvedValue({ items: [], total: 0 });
    createContactMock.mockRejectedValue(new Error("DB error"));
    findConfigMock.mockResolvedValue({ ...BASE_CONFIG, createContactsForCalls: true });

    const result = await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: ringPayload("call-contact-fail"),
    });

    // Não falha o processamento por causa do erro no contato
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(store.calls.get(result.callId)!.contactId).toBeNull();
  });

  it("chamada OUTBOUND usa toNumber para busca de contato", async () => {
    const existingContact = { id: "contact-outbound-1" };
    getContactsMock.mockResolvedValue({ items: [existingContact], total: 1 });

    const cfgOutbound = {
      ...BASE_CONFIG,
      fieldMappings: {
        ...BASE_CONFIG.fieldMappings,
        direction: "data.dir",
      },
    };
    findConfigMock.mockResolvedValue(cfgOutbound);

    const result = await processWebhookEvent({
      provider: "generic-sip",
      webhookToken: "valid-token-abc",
      rawPayload: {
        data: {
          call_id: "call-outbound",
          from: "+5511000000000",
          to: "+5521987654321",
          state: "ringing",
          ts: new Date().toISOString(),
          dir: "OUTBOUND",
        },
      },
    });

    expect(result.ok).toBe(true);
    // getContacts foi chamado com o número "to" (chamada outbound)
    expect(getContactsMock).toHaveBeenCalledWith(
      expect.objectContaining({ phoneExact: expect.any(String) }),
    );
  });
});
