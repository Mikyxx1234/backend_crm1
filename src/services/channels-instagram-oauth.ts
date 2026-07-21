/**
 * Instagram Business Login (OAuth direto, sem depender de Pagina do Facebook).
 *
 * Fluxo (padrao Kommo "entrar diretamente pelo Instagram"):
 *   1. GET /api/channels/instagram/oauth/start
 *      -> redirect 302 para https://www.instagram.com/oauth/authorize?...
 *      Guarda state assinado (HMAC + orgId) num cookie httpOnly curto.
 *   2. Usuario autoriza no instagram.com.
 *   3. Meta redireciona para GET /api/channels/instagram/oauth/callback?code=&state=
 *   4. handleCallback:
 *      - valida state
 *      - troca code por short-lived token: POST api.instagram.com/oauth/access_token
 *      - troca por long-lived (60 dias): GET graph.instagram.com/access_token
 *      - GET graph.instagram.com/v21.0/me?fields=user_id,username,name
 *      - POST graph.instagram.com/v21.0/{ig_user_id}/subscribed_apps?subscribed_fields=messages
 *      - cria Channel type=INSTAGRAM, provider=META_INSTAGRAM_LOGIN
 *
 * Docs Meta:
 *   https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Channel } from "@prisma/client";

import { createChannel, appPublicBaseUrl } from "@/services/channels";
import { CRM_META_APP_SECRET } from "@/lib/meta-constants";

const IG_APP_ID = process.env.INSTAGRAM_APP_ID?.trim() || "";
const IG_APP_SECRET = process.env.INSTAGRAM_APP_SECRET?.trim() || "";
const OAUTH_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
const OAUTH_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const GRAPH_API = "https://graph.instagram.com";
const GRAPH_API_VERSION = "v21.0";
const SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
].join(",");

/**
 * Assinatura do state OAuth. Usa CRM_META_APP_SECRET como chave (mesmo
 * segredo ja obrigatorio pro app funcionar). Formato: <orgId>.<nonce>.<hmac>.
 */
function signState(orgId: string): string {
  const nonce = randomBytes(16).toString("hex");
  const payload = `${orgId}.${nonce}`;
  const secret = IG_APP_SECRET || CRM_META_APP_SECRET;
  if (!secret) throw new IgOAuthError("INSTAGRAM_APP_SECRET nao configurado.", 500);
  const mac = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${mac}`;
}

function verifyState(state: string): { orgId: string } | null {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [orgId, nonce, mac] = parts;
  const secret = IG_APP_SECRET || CRM_META_APP_SECRET;
  if (!secret) return null;
  const expected = createHmac("sha256", secret)
    .update(`${orgId}.${nonce}`)
    .digest("hex");
  try {
    const a = Buffer.from(mac, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return { orgId };
}

export class IgOAuthError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "IgOAuthError";
    this.status = status;
  }
}

/** Monta URL de autorizacao. Chamada pela rota /oauth/start. */
export function buildAuthorizeUrl(orgId: string): { url: string; state: string } {
  if (!IG_APP_ID) throw new IgOAuthError("INSTAGRAM_APP_ID nao configurado.", 500);
  const state = signState(orgId);
  const redirectUri = `${appPublicBaseUrl()}/api/channels/instagram/oauth/callback`;
  const u = new URL(OAUTH_AUTHORIZE_URL);
  u.searchParams.set("enable_fb_login", "0");
  u.searchParams.set("force_authentication", "1");
  u.searchParams.set("client_id", IG_APP_ID);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("state", state);
  return { url: u.toString(), state };
}

type ShortTokenResponse = {
  access_token?: string;
  user_id?: string | number;
  permissions?: string;
};

type LongTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

type MeResponse = {
  user_id?: string;
  username?: string;
  name?: string;
};

/**
 * Executa a troca completa apos o callback e persiste o Channel.
 * O caller ja validou o state (via `verifyState`) e roda esta funcao
 * dentro de `withSystemContext(orgId)` para que `createChannel` injete
 * a organizationId corretamente via `withOrgFromCtx`.
 */
export async function handleCallback(
  code: string,
): Promise<{ channel: Channel; username: string }> {
  if (!IG_APP_ID || !IG_APP_SECRET) {
    throw new IgOAuthError("INSTAGRAM_APP_ID/INSTAGRAM_APP_SECRET nao configurados.", 500);
  }
  const redirectUri = `${appPublicBaseUrl()}/api/channels/instagram/oauth/callback`;

  // 1. Short-lived token (form-urlencoded).
  const form = new URLSearchParams();
  form.set("client_id", IG_APP_ID);
  form.set("client_secret", IG_APP_SECRET);
  form.set("grant_type", "authorization_code");
  form.set("redirect_uri", redirectUri);
  form.set("code", code);
  const shortRes = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const shortData = (await shortRes.json().catch(() => ({}))) as ShortTokenResponse & {
    error_message?: string;
  };
  if (!shortRes.ok || !shortData.access_token) {
    throw new IgOAuthError(
      shortData.error_message || `Falha ao trocar code (HTTP ${shortRes.status}).`,
      400,
    );
  }
  const shortToken = shortData.access_token;

  // 2. Long-lived exchange.
  const longUrl = new URL(`${GRAPH_API}/access_token`);
  longUrl.searchParams.set("grant_type", "ig_exchange_token");
  longUrl.searchParams.set("client_secret", IG_APP_SECRET);
  longUrl.searchParams.set("access_token", shortToken);
  const longRes = await fetch(longUrl.toString(), { cache: "no-store" });
  const longData = (await longRes.json().catch(() => ({}))) as LongTokenResponse;
  const longToken = longData.access_token || shortToken;

  // 3. Perfil.
  const meUrl = new URL(`${GRAPH_API}/${GRAPH_API_VERSION}/me`);
  meUrl.searchParams.set("fields", "user_id,username,name");
  meUrl.searchParams.set("access_token", longToken);
  const meRes = await fetch(meUrl.toString(), { cache: "no-store" });
  const meData = (await meRes.json().catch(() => ({}))) as MeResponse & {
    error?: { message?: string };
  };
  const instagramUserId = meData.user_id?.trim();
  const username = meData.username?.trim() || "";
  const displayName = meData.name?.trim() || username;
  if (!instagramUserId) {
    throw new IgOAuthError(
      meData.error?.message || "Meta nao retornou user_id do Instagram.",
      502,
    );
  }

  // 4. Subscribe webhook.
  const subUrl = new URL(
    `${GRAPH_API}/${GRAPH_API_VERSION}/${instagramUserId}/subscribed_apps`,
  );
  subUrl.searchParams.set("subscribed_fields", "messages");
  subUrl.searchParams.set("access_token", longToken);
  const subRes = await fetch(subUrl.toString(), { method: "POST" });
  if (!subRes.ok) {
    const subErr = (await subRes.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new IgOAuthError(
      `Falha ao assinar webhooks: ${subErr.error?.message || `HTTP ${subRes.status}`}`,
      400,
    );
  }

  // 5. Cria Channel. Usamos prismaBase indireto: createChannel usa
  // withOrgFromCtx, entao precisamos rodar dentro de contexto da org.
  // Aqui recebemos o orgId via state; o caller e responsavel por rodar
  // handleCallback dentro de withSystemContext(orgId).
  const config: Record<string, unknown> = {
    platform: "instagram",
    instagramUserId,
    username,
    accessToken: longToken, // encriptado por encryptChannelConfig
  };
  if (displayName) config.displayName = displayName;

  const channel = await createChannel({
    name: `Instagram @${username || instagramUserId}`,
    type: "INSTAGRAM",
    provider: "META_INSTAGRAM_LOGIN",
    config,
  });

  return { channel, username };
}

export { verifyState };
export const IG_OAUTH_INTERNAL = {
  signState,
  verifyState,
};
