/**
 * Cobertura do OAuth Instagram Business Login (redirect direto).
 * Foca no que nao depende de IO real: assinatura HMAC do state e
 * verificacao. Fluxo de token/subscribe e testado via integracao.
 */
import { describe, expect, it, beforeAll } from "vitest";

// O modulo le INSTAGRAM_APP_SECRET / CRM_META_APP_SECRET no import time
// para assinatura. Setamos antes do import dinamico.
beforeAll(() => {
  process.env.META_APP_SECRET = "test-secret-xyz";
  process.env.INSTAGRAM_APP_ID = "ig-app-id";
  process.env.INSTAGRAM_APP_SECRET = "ig-secret";
});

describe("channels-instagram-oauth: state HMAC", () => {
  it("assina e verifica state para a mesma org", async () => {
    const mod = await import("@/services/channels-instagram-oauth");
    const state = mod.IG_OAUTH_INTERNAL.signState("org-123");
    expect(state.split(".")).toHaveLength(3);
    const v = mod.verifyState(state);
    expect(v?.orgId).toBe("org-123");
  });

  it("rejeita state com HMAC adulterado", async () => {
    const mod = await import("@/services/channels-instagram-oauth");
    const state = mod.IG_OAUTH_INTERNAL.signState("org-abc");
    const [org, nonce] = state.split(".");
    const tampered = `${org}.${nonce}.deadbeef`;
    expect(mod.verifyState(tampered)).toBeNull();
  });

  it("rejeita state mal-formado", async () => {
    const mod = await import("@/services/channels-instagram-oauth");
    expect(mod.verifyState("nope")).toBeNull();
    expect(mod.verifyState("a.b")).toBeNull();
  });

  it("buildAuthorizeUrl inclui client_id, scope e state assinado", async () => {
    process.env.NEXTAUTH_URL = "https://crm.example.com";
    const mod = await import("@/services/channels-instagram-oauth");
    const { url, state } = mod.buildAuthorizeUrl("org-xyz");
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("ig-app-id");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toContain("instagram_business_basic");
    expect(u.searchParams.get("state")).toBe(state);
    const v = mod.verifyState(state);
    expect(v?.orgId).toBe("org-xyz");
  });
});
