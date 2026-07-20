/**
 * Testes do MetaMessagingClient — foco no formato do body enviado
 * ao endpoint /{pageId}/messages e no tratamento de erro da Graph.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MetaMessagingClient, messagingClientFromConfig } from "@/lib/meta-messaging/client";

describe("MetaMessagingClient.sendText", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTa com recipient.id, message.text e messaging_type=RESPONSE", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message_id: "mid_123" }), { status: 200 }),
    );

    const c = new MetaMessagingClient("tok", "PAGE_1");
    const res = await c.sendText("PSID_ABC", "oi");
    expect(res.message_id).toBe("mid_123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/PAGE_1/messages");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.recipient).toEqual({ id: "PSID_ABC" });
    expect(body.message).toEqual({ text: "oi" });
    expect(body.messaging_type).toBe("RESPONSE");
    // Sem tag por padrao
    expect(body.tag).toBeUndefined();
    // Authorization header
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("propaga tag/messagingType quando fornecidos", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message_id: "mid_9" }), { status: 200 }),
    );
    const c = new MetaMessagingClient("tok", "PAGE_1");
    await c.sendText("PSID", "x", { messagingType: "MESSAGE_TAG", tag: "HUMAN_AGENT" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messaging_type).toBe("MESSAGE_TAG");
    expect(body.tag).toBe("HUMAN_AGENT");
  });

  it("lanca MetaGraphError quando a Graph retorna erro", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { message: "Invalid access token", code: 190, fbtrace_id: "abc" },
        }),
        { status: 400 },
      ),
    );
    const c = new MetaMessagingClient("bad", "PAGE_1");
    await expect(c.sendText("PSID", "oi")).rejects.toThrow(/Invalid access token|code 190/);
  });

  it("configured=false quando token ou pageId ausentes", () => {
    expect(new MetaMessagingClient("", "PAGE").configured).toBe(false);
    expect(new MetaMessagingClient("tok", "").configured).toBe(false);
    expect(new MetaMessagingClient("tok", "PAGE").configured).toBe(true);
  });
});

describe("messagingClientFromConfig", () => {
  it("aceita plaintext accessToken", () => {
    const c = messagingClientFromConfig({ accessToken: "tok", pageId: "PAGE_X" });
    expect(c.configured).toBe(true);
  });

  it("retorna cliente nao configurado quando config vazio", () => {
    expect(messagingClientFromConfig(null).configured).toBe(false);
    expect(messagingClientFromConfig({}).configured).toBe(false);
  });

  it("Instagram Direct: usa graph.instagram.com/me/messages", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ message_id: "mid_ig" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const c = messagingClientFromConfig({
      platform: "instagram",
      instagramUserId: "17841400000000000",
      accessToken: "IGAA...",
    });
    await c.sendText("IGSID_1", "oi");
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://graph.instagram.com/v21.0/me/messages",
    );
  });

  it("Messenger: usa graph.facebook.com/{pageId}/messages", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ message_id: "mid_fb" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const c = messagingClientFromConfig({
      platform: "messenger",
      pageId: "PAGE_99",
      accessToken: "EAA...",
    });
    await c.sendText("PSID_9", "oi");
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://graph.facebook.com/v21.0/PAGE_99/messages",
    );
  });
});
