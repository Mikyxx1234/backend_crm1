/**
 * Conexao manual do Instagram Direct — mesmo modelo do WhatsApp
 * `/api/channels/manual-cloud` (App Meta da org, org por org).
 *
 * O cliente cola token + Instagram User ID + App Secret. O webhook e a
 * URL opaca `/api/webhooks/meta/<webhookId>` gerada pelo botao Webhook.
 */
import type { Channel } from "@prisma/client";

import {
  createChannel,
  getChannelById,
  updateChannel,
} from "@/services/channels";

const GRAPH_API_VERSION = "v21.0";
const IG_GRAPH = `https://graph.instagram.com/${GRAPH_API_VERSION}`;

export class IgManualProvisionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "IgManualProvisionError";
    this.status = status;
  }
}

export type ProvisionInstagramManualInput = {
  accessToken: string;
  instagramUserId?: string;
  name?: string;
  channelId?: string;
  verifyToken?: string;
  webhookId?: string;
  appSecret?: string;
};

type MeResponse = {
  user_id?: string;
  id?: string;
  username?: string;
  name?: string;
  error?: { message?: string };
};

export async function provisionInstagramManualChannel(
  input: ProvisionInstagramManualInput,
): Promise<{
  channel: Channel;
  created: boolean;
  username: string;
  webhookSubscribed: boolean;
}> {
  const accessToken = input.accessToken.trim();
  if (!accessToken) {
    throw new IgManualProvisionError("Token de acesso e obrigatorio.", 400);
  }
  if (input.channelId) {
    const existing = await getChannelById(input.channelId);
    if (!existing) throw new IgManualProvisionError("Canal nao encontrado.", 404);
  }

  const meUrl = new URL(`${IG_GRAPH}/me`);
  meUrl.searchParams.set("fields", "user_id,username,name,id");
  meUrl.searchParams.set("access_token", accessToken);
  const meRes = await fetch(meUrl.toString(), { cache: "no-store" });
  const meData = (await meRes.json().catch(() => ({}))) as MeResponse;
  const meId = (meData.user_id || meData.id || "").trim();
  const username = (meData.username || "").trim();
  const displayName = (meData.name || username).trim();

  const instagramUserId = (input.instagramUserId || meId).trim();
  if (!instagramUserId) {
    throw new IgManualProvisionError(
      meData.error?.message ||
        "Meta nao retornou o Instagram User ID. Cole o ID da conta Business.",
      400,
    );
  }
  if (meId && meId !== instagramUserId) {
    throw new IgManualProvisionError(
      `O token pertence ao ID ${meId}, nao ao ${instagramUserId}.`,
      400,
    );
  }

  let webhookSubscribed = false;
  const subUrl = new URL(`${IG_GRAPH}/${instagramUserId}/subscribed_apps`);
  subUrl.searchParams.set("subscribed_fields", "messages");
  subUrl.searchParams.set("access_token", accessToken);
  const subRes = await fetch(subUrl.toString(), { method: "POST" });
  if (subRes.ok) {
    webhookSubscribed = true;
  } else {
    const subErr = (await subRes.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    console.warn(
      "[provisionInstagramManual] subscribed_apps non-fatal:",
      subErr.error?.message || `HTTP ${subRes.status}`,
    );
  }

  const config: Record<string, unknown> = {
    platform: "instagram",
    instagramUserId,
    username,
    accessToken,
  };
  if (displayName) config.displayName = displayName;
  if (input.verifyToken) config.verifyToken = input.verifyToken;
  if (input.webhookId) config.webhookId = input.webhookId;
  if (input.appSecret) config.appSecret = input.appSecret;

  const name =
    input.name?.trim() ||
    `Instagram @${username || instagramUserId}`;

  let channel: Channel;
  let created = false;
  if (input.channelId) {
    channel = await updateChannel(input.channelId, {
      name,
      type: "INSTAGRAM",
      provider: "META_INSTAGRAM_LOGIN",
      config,
      status: "CONNECTED",
      lastConnectedAt: new Date(),
    });
  } else {
    channel = await createChannel({
      name,
      type: "INSTAGRAM",
      provider: "META_INSTAGRAM_LOGIN",
      config,
    });
    channel = await updateChannel(channel.id, {
      status: "CONNECTED",
      lastConnectedAt: new Date(),
    });
    created = true;
  }

  return { channel, created, username, webhookSubscribed };
}
