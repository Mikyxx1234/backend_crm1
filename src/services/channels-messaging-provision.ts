/**
 * Provisionamento de canais de mensageria da Meta (Facebook Messenger e
 * Instagram Direct) via Facebook Login OAuth.
 *
 * Fluxo:
 *   1. Recebe `code` do FB.login (front) + `pageId` selecionado pelo usuario.
 *   2. Troca `code` -> short-lived user access token.
 *   3. Troca por long-lived user access token (60 dias).
 *   4. GET /me/accounts -> lista Paginas do usuario com seus Page Access Tokens
 *      (que sao "never expire" apos long-lived exchange). Localiza a Pagina
 *      escolhida e extrai o Page Access Token.
 *   5. POST /{pageId}/subscribed_apps -> assina o App do CRM aos eventos
 *      messaging da Pagina (equivalente ao subscribed_apps do WABA).
 *   6. Para INSTAGRAM: GET /{pageId}?fields=instagram_business_account -> IG id.
 *   7. Cria/atualiza Channel com type=FACEBOOK|INSTAGRAM, provider=META_CLOUD_API.
 *      Page Token e persistido em config.accessToken (encriptado por
 *      encryptChannelConfig — mesmo fluxo do WhatsApp).
 *
 * Diferencas vs `channels-meta-provision.ts` (WhatsApp Cloud):
 *   - Identidade do canal e `pageId` (nao `phoneNumberId`) para Messenger,
 *     ou `instagramAccountId` + `pageId` para IG.
 *   - Callback URL global do App (nao scoped por org): resolucao no webhook
 *     usa entry[].id = pageId/igId.
 *   - Nao ha "/register" nem "twoStepPin" — Paginas nao precisam disso.
 */
import type { Channel } from "@prisma/client";

import { createChannel, getChannelById, updateChannel } from "@/services/channels";
import { CRM_META_APP_ID, CRM_META_APP_SECRET } from "@/lib/meta-constants";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export type MessagingPlatform = "messenger" | "instagram";

export type ProvisionMessagingChannelInput = {
  /** OAuth code do FB.login (response_type=code). */
  code: string;
  /** Page ID selecionada pelo usuario (obrigatorio). */
  pageId: string;
  /** Plataforma: "messenger" (FACEBOOK) ou "instagram" (INSTAGRAM). */
  platform: MessagingPlatform;
  /** Nome opcional do canal (fallback = nome da Pagina/IG). */
  name?: string;
  /** Se informado, atualiza canal existente em vez de criar. */
  channelId?: string;
};

export type ProvisionMessagingChannelResult = {
  channel: Channel;
  created: boolean;
  pageId: string;
  pageName: string;
  instagramAccountId: string | null;
  /** true se subscribed_apps confirmou (Pagina agora manda webhooks). */
  subscribed: boolean;
};

export class MessagingProvisionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "MessagingProvisionError";
    this.status = status;
  }
}

type PageAccount = {
  id: string;
  name?: string;
  access_token?: string;
};

async function graphGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (data.error ?? {}) as Record<string, unknown>;
    const msg = typeof err.message === "string" ? err.message : `Graph HTTP ${res.status}`;
    throw new MessagingProvisionError(`Meta Graph: ${msg}`, 400);
  }
  return data as T;
}

/** Passo 2-3: code -> short-lived user token -> long-lived user token. */
async function exchangeCodeForLongLivedToken(code: string): Promise<string> {
  const appId = CRM_META_APP_ID;
  const appSecret = CRM_META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new MessagingProvisionError(
      "App Meta nao configurado (CRM_META_APP_ID/CRM_META_APP_SECRET).",
      500,
    );
  }

  // Sem redirect_uri: FB.login com response_type=code aceita omissao.
  const shortUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
  shortUrl.searchParams.set("client_id", appId);
  shortUrl.searchParams.set("client_secret", appSecret);
  shortUrl.searchParams.set("code", code);
  const short = await graphGet<{ access_token?: string }>(shortUrl.toString());
  const shortToken = short.access_token?.trim();
  if (!shortToken) {
    throw new MessagingProvisionError("Meta nao retornou access_token na troca do code.", 502);
  }

  const longUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", appId);
  longUrl.searchParams.set("client_secret", appSecret);
  longUrl.searchParams.set("fb_exchange_token", shortToken);
  const long = await graphGet<{ access_token?: string }>(longUrl.toString());
  const longToken = long.access_token?.trim();
  return longToken || shortToken;
}

/**
 * Lista todas as Paginas do usuario com seus Page Access Tokens.
 * Precisa da permissao `pages_show_list`.
 */
export async function listUserPages(userToken: string): Promise<PageAccount[]> {
  const url = new URL(`${GRAPH_BASE}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token");
  url.searchParams.set("access_token", userToken);
  const res = await graphGet<{ data?: PageAccount[] }>(url.toString());
  return res.data ?? [];
}

/**
 * Executa o fluxo completo: troca code, localiza Pagina, subscribe webhooks,
 * resolve IG account (se plataforma=instagram) e persiste o Channel.
 */
export async function provisionMessagingChannel(
  input: ProvisionMessagingChannelInput,
): Promise<ProvisionMessagingChannelResult> {
  const code = input.code.trim();
  const pageId = input.pageId.trim();
  if (!code) throw new MessagingProvisionError("code e obrigatorio.", 400);
  if (!pageId) throw new MessagingProvisionError("pageId e obrigatorio.", 400);

  if (input.channelId) {
    const existing = await getChannelById(input.channelId);
    if (!existing) throw new MessagingProvisionError("Canal nao encontrado.", 404);
  }

  const userToken = await exchangeCodeForLongLivedToken(code);
  const pages = await listUserPages(userToken);

  const page = pages.find((p) => p.id === pageId);
  if (!page) {
    throw new MessagingProvisionError(
      "Pagina selecionada nao encontrada nas suas Paginas do Facebook (verifique permissoes).",
      404,
    );
  }
  const pageAccessToken = page.access_token?.trim();
  if (!pageAccessToken) {
    throw new MessagingProvisionError(
      "Meta nao retornou Page Access Token (permissao pages_manage_metadata ausente?).",
      400,
    );
  }
  const pageName = page.name?.trim() || `Page ${page.id}`;

  // Subscribed_apps: campos que queremos receber via webhook.
  // - messages: DMs recebidas
  // - messaging_postbacks: cliques em botoes / quick replies
  // - message_reads / message_deliveries: acks (opcional)
  const subscribedFields =
    input.platform === "instagram"
      ? "messages,messaging_postbacks"
      : "messages,messaging_postbacks,message_deliveries,message_reads";
  const subUrl = new URL(`${GRAPH_BASE}/${pageId}/subscribed_apps`);
  subUrl.searchParams.set("subscribed_fields", subscribedFields);
  subUrl.searchParams.set("access_token", pageAccessToken);
  const subRes = await fetch(subUrl.toString(), { method: "POST" });
  let subscribed = false;
  if (subRes.ok) {
    subscribed = true;
  } else {
    const subErr = (await subRes.json().catch(() => ({}))) as Record<string, unknown>;
    const err = (subErr.error ?? {}) as Record<string, unknown>;
    const msg = typeof err.message === "string" ? err.message : "Falha em subscribed_apps.";
    throw new MessagingProvisionError(
      `Nao foi possivel assinar o webhook na Pagina: ${msg}`,
      400,
    );
  }

  // Para Instagram: descobrir o instagram_business_account ligado a Pagina.
  let instagramAccountId: string | null = null;
  if (input.platform === "instagram") {
    const igUrl = new URL(`${GRAPH_BASE}/${pageId}`);
    igUrl.searchParams.set("fields", "instagram_business_account");
    igUrl.searchParams.set("access_token", pageAccessToken);
    const igData = await graphGet<{
      instagram_business_account?: { id?: string };
    }>(igUrl.toString());
    instagramAccountId = igData.instagram_business_account?.id?.trim() || null;
    if (!instagramAccountId) {
      throw new MessagingProvisionError(
        "Esta Pagina nao tem uma conta Instagram Business vinculada. Vincule no Meta Business Suite e tente novamente.",
        400,
      );
    }
  }

  const config: Record<string, unknown> = {
    platform: input.platform,
    pageId,
    pageName,
    accessToken: pageAccessToken, // encriptado por encryptChannelConfig
  };
  if (instagramAccountId) config.instagramAccountId = instagramAccountId;

  const channelType = input.platform === "instagram" ? "INSTAGRAM" : "FACEBOOK";
  const defaultName =
    input.platform === "instagram" ? `Instagram ${pageName}` : `Messenger ${pageName}`;

  let channel: Channel;
  let created = false;
  if (input.channelId) {
    channel = await updateChannel(input.channelId, {
      name: input.name?.trim() || undefined,
      config,
      status: "CONNECTED",
      lastConnectedAt: new Date(),
    });
  } else {
    channel = await createChannel({
      name: input.name?.trim() || defaultName,
      type: channelType,
      provider: "META_CLOUD_API",
      config,
    });
    channel = await updateChannel(channel.id, {
      status: "CONNECTED",
      lastConnectedAt: new Date(),
    });
    created = true;
  }

  return {
    channel,
    created,
    pageId,
    pageName,
    instagramAccountId,
    subscribed,
  };
}

/**
 * Auxiliar do frontend: troca code por Paginas listadas, para o usuario
 * escolher qual conectar (quando ele tem mais de uma). Nao persiste nada.
 */
export async function listPagesFromCode(
  code: string,
): Promise<{ userToken: string; pages: PageAccount[] }> {
  const userToken = await exchangeCodeForLongLivedToken(code);
  const pages = await listUserPages(userToken);
  return { userToken, pages };
}
