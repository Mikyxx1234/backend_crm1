/**
 * Resolve identidade Instagram no fluxo manual: token Instagram Login
 * vs token Facebook (Usuario do sistema / Pagina).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  IG_MANUAL_INTERNAL,
} from "@/services/channels-instagram-manual";

describe("sanitizeMetaAccessToken", () => {
  it("remove Bearer, aspas e espacos", () => {
    expect(
      IG_MANUAL_INTERNAL.sanitizeMetaAccessToken('  Bearer "EAA tok" \n'),
    ).toBe("EAAtok");
  });
});

describe("resolveInstagramManualIdentity", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("usa graph.instagram.com quando o token e Instagram Login", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user_id: "1784140001",
            username: "loja",
            name: "Loja",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    const identity = await IG_MANUAL_INTERNAL.resolveInstagramManualIdentity(
      "IGAA.xxx",
    );
    expect(identity.provider).toBe("META_INSTAGRAM_LOGIN");
    expect(identity.instagramUserId).toBe("1784140001");
    expect(identity.webhookSubscribed).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toContain("graph.instagram.com");
  });

  it("cai no graph.facebook.com quando o token de sistema nao parseia no Instagram Login", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: "Invalid OAuth access token - Cannot parse access token" },
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "SYS_1", name: "System" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "PAGE_9",
                name: "Pagina Loja",
                access_token: "EAA_PAGE",
                instagram_business_account: {
                  id: "1784140001",
                  username: "loja",
                  name: "Loja IG",
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    const identity = await IG_MANUAL_INTERNAL.resolveInstagramManualIdentity(
      "EAAZAO8um3nLxxx",
    );
    expect(identity.provider).toBe("META_CLOUD_API");
    expect(identity.pageId).toBe("PAGE_9");
    expect(identity.instagramAccountId).toBe("1784140001");
    expect(identity.accessToken).toBe("EAA_PAGE");
    expect(identity.webhookSubscribed).toBe(true);
    expect(String(fetchMock.mock.calls[1][0])).toContain("graph.facebook.com");
  });

  it("explica permissoes quando o token EAA nao lista Pagina com Instagram", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: "Invalid OAuth access token - Cannot parse access token" },
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "SYS_1", name: "System" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "PAGE_9", name: "Sem IG" }] }), {
          status: 200,
        }),
      );

    await expect(
      IG_MANUAL_INTERNAL.resolveInstagramManualIdentity("EAA_BAD"),
    ).rejects.toThrow(/instagram_manage_messages|Entrar com Instagram/i);
  });
});
