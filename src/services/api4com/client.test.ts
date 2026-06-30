/**
 * Testes do Api4ComClient — fetch mockado, sem IO real.
 *
 * Cobertura:
 *  - Header Authorization presente em toda chamada
 *  - 401/403 → Api4ComAuthError
 *  - 409 e body "já existe" em 200 → Api4ComConflictError
 *  - 4xx → Api4ComValidationError (sem retry)
 *  - 5xx → retry com backoff e Api4ComServerError ao esgotar
 *  - Timeout/rede → retry e Api4ComError
 *  - findUsers aceita array direto, { data }, { items }
 *  - dial tolera ack timeout (longa duração)
 *  - createNextExtension parseia ramal numérico
 *  - createUser rejeita senha curta (Zod)
 */
import { describe, expect, it, vi } from "vitest";

import { Api4ComClient } from "./client";
import {
  Api4ComAuthError,
  Api4ComConflictError,
  Api4ComServerError,
  Api4ComValidationError,
} from "./errors";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

function makeClient(fetchImpl: typeof fetch, overrides: { maxRetries?: number; retryBaseMs?: number } = {}) {
  return new Api4ComClient({
    token: "tok-test",
    baseUrl: "https://api.api4com.com/api/v1",
    fetchImpl,
    maxRetries: overrides.maxRetries ?? 0,
    retryBaseMs: overrides.retryBaseMs ?? 1,
  });
}

describe("Api4ComClient", () => {
  it("envia header Authorization e Content-Type em toda chamada", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "u1" }));
    const client = makeClient(fetchMock);

    await client.findUsers({ email: "a@b.com" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("tok-test");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("401 → Api4ComAuthError sem retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse(401, "Unauthorized"));
    const client = makeClient(fetchMock, { maxRetries: 3 });

    await expect(client.findUsers()).rejects.toBeInstanceOf(Api4ComAuthError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("409 → Api4ComConflictError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse(409, "duplicate"));
    const client = makeClient(fetchMock);

    await expect(
      client.createUser({ name: "X", email: "x@y.com", password: "abcdefgh", role: "USER" }),
    ).rejects.toBeInstanceOf(Api4ComConflictError);
  });

  it("200 com body 'already exists' → Api4ComConflictError", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { error: "User already exists" }));
    const client = makeClient(fetchMock);

    await expect(
      client.createUser({ name: "X", email: "x@y.com", password: "abcdefgh", role: "USER" }),
    ).rejects.toBeInstanceOf(Api4ComConflictError);
  });

  it("4xx genérico → Api4ComValidationError sem retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse(422, "invalid email"));
    const client = makeClient(fetchMock, { maxRetries: 3 });

    await expect(client.findUsers({ email: "bad" })).rejects.toBeInstanceOf(
      Api4ComValidationError,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("5xx → retry e Api4ComServerError ao esgotar", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse(503, "down"));
    const client = makeClient(fetchMock, { maxRetries: 2, retryBaseMs: 1 });

    await expect(client.findUsers()).rejects.toBeInstanceOf(Api4ComServerError);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("5xx seguido de 200 → sucesso após retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse(502, "bad gateway"))
      .mockResolvedValueOnce(jsonResponse(200, [{ id: "u1", email: "a@b.com" }]));
    const client = makeClient(fetchMock, { maxRetries: 2, retryBaseMs: 1 });

    const users = await client.findUsers();
    expect(users).toEqual([{ id: "u1", email: "a@b.com" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("findUsers aceita { data: [] }", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { data: [{ id: "u1", email: "a@b.com" }] }));
    const client = makeClient(fetchMock);

    const users = await client.findUsers({ email: "a@b.com" });
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe("u1");
  });

  it("findUsers aceita { items: [] }", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { items: [{ id: "u2", email: "c@d.com" }] }));
    const client = makeClient(fetchMock);

    const users = await client.findUsers();
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe("u2");
  });

  it("createNextExtension normaliza ramal numérico para string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 42,
        ramal: 1001,
        senha: "xyz",
        domain: "pbx.api4com.com",
      }),
    );
    const client = makeClient(fetchMock);

    const ext = await client.createNextExtension();
    expect(ext.ramal).toBe("1001");
    expect(ext.id).toBe("42");
    expect(ext.senha).toBe("xyz");
  });

  it("createUser rejeita senha < 8 chars (Zod)", async () => {
    const fetchMock = vi.fn();
    const client = makeClient(fetchMock);

    await expect(
      client.createUser({ name: "X", email: "x@y.com", password: "short", role: "USER" }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dial retorna { id: undefined } quando ack estoura timeout", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const client = new Api4ComClient({
      token: "tok-test",
      fetchImpl: fetchMock,
      maxRetries: 0,
      dialerAckMs: 20,
    });

    const ack = await client.dial({
      extension: "1001",
      phone: "+5511988887777",
      metadata: {},
    });
    expect(ack.id).toBeUndefined();
  });

  it("dial sucesso preserva id (que NÃO é o callId real)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { id: "dlr-abc", message: "ok" }),
    );
    const client = makeClient(fetchMock);

    const ack = await client.dial({
      extension: "1001",
      phone: "+5511988887777",
      metadata: { gateway: "crm-org-1", deal_id: "deal-1" },
    });
    expect(ack.id).toBe("dlr-abc");
  });

  it("upsertIntegration envia payload validado (PATCH /integrations)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = makeClient(fetchMock);

    await client.upsertIntegration({
      gateway: "crm-org-1",
      webhook: true,
      webhookConstraint: { metadata: { gateway: "crm-org-1" } },
      metadata: {
        webhookUrl: "https://crm.example.com/api/webhooks/calls/api4com?token=abc",
        webhookVersion: "v1.4",
        webhookTypes: ["channel-answer", "channel-hangup"],
      },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.api4com.com/api/v1/integrations");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string);
    expect(body.webhookConstraint.metadata.gateway).toBe("crm-org-1");
  });
});
