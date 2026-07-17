/**
 * Handler dos webhooks de mensageria da Meta:
 *   - object === "page"      -> Facebook Messenger
 *   - object === "instagram" -> Instagram Direct
 *
 * Diferencas vs o handler do WhatsApp (`./handler.ts`):
 *   - Payload usa `entry[].messaging[]` (nao `changes[].value.messages`).
 *   - Identidade do canal e `entry[].id` (pageId para Messenger, IGSID da
 *     conta business para Instagram) — NAO ha `phone_number_id`.
 *   - Destinatarios sao PSID/IGSID em `sender.id` — nao ha telefone.
 *
 * Callback URL: uma so, global do App (nao scoped por org). Assinatura
 * validada com CRM_META_APP_SECRET (o mesmo App do CRM que provisiona os
 * WhatsApps via subscribed_apps).
 */
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { withSystemContext } from "@/lib/webhook-context";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { getOrgIdOrNull } from "@/lib/request-context";
import { CRM_META_APP_SECRET } from "@/lib/meta-constants";
import { verifyMetaWebhookSignature } from "@/lib/meta-webhook-signature";
import { decryptSecret, isEncryptedSecret } from "@/lib/crypto/secrets";
import { sseBus } from "@/lib/sse-bus";
import {
  isActiveConversationUniqueViolation,
  withConversationNumberRetry,
} from "@/services/conversations";
import { nextContactNumber } from "@/services/contacts";
import { sanitizeContactName } from "@/lib/display-name";
import { notifyInboundMessage } from "@/lib/web-push";
import { getLogger } from "@/lib/logger";

const log = getLogger("meta-messaging-webhook");
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() || "";
const REQUIRE_SIGNATURE = process.env.NODE_ENV === "production";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

type Platform = "messenger" | "instagram";

// ── GET: verificacao ────────────────────────────────────────

/**
 * GET /api/webhooks/meta/messaging — handshake da Meta.
 * Valida hub.verify_token contra META_WEBHOOK_VERIFY_TOKEN global.
 */
export async function handleMessagingWebhookGet(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (!VERIFY_TOKEN) {
    log.error("META_WEBHOOK_VERIFY_TOKEN nao configurado — recusando handshake");
    return NextResponse.json(
      { error: "Webhook verification not configured" },
      { status: 503 },
    );
  }
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    log.info("Verificacao messaging webhook: OK");
    return new Response(challenge ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// ── POST: recebimento ──────────────────────────────────────

export async function handleMessagingWebhookPost(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  let signatureValid = false;
  if (CRM_META_APP_SECRET) {
    signatureValid = verifyMetaWebhookSignature(rawBody, signature, CRM_META_APP_SECRET);
    if (!signatureValid) {
      log.warn("Assinatura invalida — recusando POST messaging");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (REQUIRE_SIGNATURE) {
    log.error("PROD sem META_APP_SECRET — recusando POST messaging");
    return NextResponse.json(
      { error: "Webhook signature verification not configured" },
      { status: 503 },
    );
  } else {
    log.debug("Sem CRM_META_APP_SECRET — assinatura nao verificada (dev)");
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const object = typeof body.object === "string" ? body.object : "";
  let platform: Platform | null = null;
  if (object === "page") platform = "messenger";
  else if (object === "instagram") platform = "instagram";
  else {
    // Nao e' um objeto messaging — ignoramos (o handler WhatsApp trata outros).
    return NextResponse.json({ status: "ignored", object });
  }

  const entries = Array.isArray(body.entry) ? body.entry : [];
  for (const entry of entries) {
    try {
      await processEntry(entry, platform);
    } catch (err) {
      log.error("Erro ao processar entry (nao-fatal):", err);
    }
  }

  return NextResponse.json({ status: "ok" });
}

// ── Types minimo do payload ─────────────────────────────────

type WebhookBody = {
  object?: unknown;
  entry?: WebhookEntry[];
};

type WebhookEntry = {
  id?: string;
  time?: number;
  messaging?: MessagingEvent[];
};

type MessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    attachments?: Array<{
      type?: string;
      payload?: { url?: string; sticker_id?: number };
    }>;
    is_echo?: boolean;
  };
  postback?: { mid?: string; title?: string; payload?: string };
  read?: { watermark?: number };
  delivery?: { mids?: string[]; watermark?: number };
};

// ── Resolve org/canal por entry.id ─────────────────────────

type ChannelHit = {
  channelId: string;
  organizationId: string;
  channelType: "FACEBOOK" | "INSTAGRAM";
  pageId: string;
  accessToken: string;
};

async function findChannelByEntryId(
  entryId: string,
  platform: Platform,
): Promise<ChannelHit | null> {
  const path = platform === "instagram" ? "instagramAccountId" : "pageId";
  const channel = await prismaBase.channel.findFirst({
    where: {
      type: platform === "instagram" ? "INSTAGRAM" : "FACEBOOK",
      provider: "META_CLOUD_API",
      config: { path: [path], equals: entryId },
    },
    select: {
      id: true,
      organizationId: true,
      type: true,
      config: true,
    },
  });
  if (!channel) return null;

  const cfg = (channel.config ?? {}) as Record<string, unknown>;
  const pageId = typeof cfg.pageId === "string" ? cfg.pageId : "";
  const tokenRaw = typeof cfg.accessToken === "string" ? cfg.accessToken : "";
  const token = tokenRaw && isEncryptedSecret(tokenRaw)
    ? safeDecrypt(tokenRaw)
    : tokenRaw;

  return {
    channelId: channel.id,
    organizationId: channel.organizationId,
    channelType: channel.type as "FACEBOOK" | "INSTAGRAM",
    pageId,
    accessToken: token,
  };
}

function safeDecrypt(v: string): string {
  try {
    return decryptSecret(v);
  } catch (err) {
    log.error("Falha ao decriptar accessToken:", err);
    return "";
  }
}

// ── Processa uma entry ─────────────────────────────────────

async function processEntry(entry: WebhookEntry, platform: Platform): Promise<void> {
  const entryId = typeof entry.id === "string" ? entry.id : "";
  const events = Array.isArray(entry.messaging) ? entry.messaging : [];
  if (!entryId || events.length === 0) return;

  const hit = await findChannelByEntryId(entryId, platform);
  if (!hit) {
    log.debug(`entry.id=${entryId} (${platform}) nao mapeado a canal — ignorando`);
    return;
  }

  await withSystemContext(hit.organizationId, async () => {
    for (const ev of events) {
      try {
        await processEvent(ev, hit, platform);
      } catch (err) {
        log.error("Erro ao processar evento (nao-fatal):", err);
      }
    }
  });
}

async function processEvent(
  ev: MessagingEvent,
  hit: ChannelHit,
  platform: Platform,
): Promise<void> {
  const senderId = typeof ev.sender?.id === "string" ? ev.sender.id.trim() : "";
  if (!senderId) return;

  // Ignora echo do proprio negocio (nossa mensagem enviada volta como evento)
  if (ev.message?.is_echo) return;

  // Ignora acks (read/delivery) por enquanto — foco no MVP e' new_message.
  if (ev.read || ev.delivery) return;

  const isPostback = Boolean(ev.postback);
  const isMessage = Boolean(ev.message);
  if (!isPostback && !isMessage) return;

  const externalId =
    (ev.message?.mid || ev.postback?.mid || "").trim() || null;
  const text = isPostback
    ? ev.postback?.title || ev.postback?.payload || ""
    : ev.message?.text || "";
  const timestamp = ev.timestamp ? new Date(ev.timestamp) : new Date();

  // Idempotencia: se ja gravamos essa mid, ignora.
  if (externalId) {
    const existing = await prisma.message.findFirst({
      where: { externalId },
      select: { id: true },
    });
    if (existing) return;
  }

  const contact = await upsertContact(senderId, platform, hit);
  const conversation = await findOrCreateConversation(contact.id, platform, hit.channelId);

  // Anexos: guardamos o primeiro URL como preview no `content` quando nao ha texto.
  let content = text;
  const firstAttachment = ev.message?.attachments?.[0];
  if (!content && firstAttachment) {
    const url = firstAttachment.payload?.url;
    const type = firstAttachment.type || "attachment";
    content = url ? `[${type}] ${url}` : `[${type}]`;
  }

  await prisma.message.create({
    data: withOrgFromCtx({
      conversationId: conversation.id,
      channelId: hit.channelId,
      direction: "in" as const,
      content: content || "",
      externalId,
      createdAt: timestamp,
    }),
  });

  try {
    sseBus.publish("new_message", {
      organizationId: getOrgIdOrNull(),
      conversationId: conversation.id,
      contactId: contact.id,
      direction: "in",
      content,
      timestamp,
    });
  } catch (err) {
    log.debug("SSE publish falhou (nao-fatal):", err);
  }

  notifyInboundMessage({
    conversationId: conversation.id,
    contactId: contact.id,
    contactName: contact.name,
    preview: content || "[midia]",
    channel: platform === "instagram" ? "Instagram" : "Messenger",
  }).catch((err) => log.debug("push falhou (nao-fatal):", err));
}

// ── Upsert de Contact por PSID/IGSID ────────────────────────

async function upsertContact(
  externalUserId: string,
  platform: Platform,
  hit: ChannelHit,
): Promise<{ id: string; name: string }> {
  const field = platform === "instagram" ? "instagramIgsid" : "messengerPsid";

  const existing = await prisma.contact.findFirst({
    where: { [field]: externalUserId } as Prisma.ContactWhereInput,
    select: { id: true, name: true },
  });
  if (existing) return existing;

  // Best-effort fetch do perfil publico (nome). Falhas nao bloqueiam.
  const profile = await fetchProfileName(externalUserId, hit).catch(() => null);
  const name =
    (profile ? sanitizeContactName(profile) || profile : null) ||
    `${platform === "instagram" ? "Instagram" : "Messenger"} ${externalUserId.slice(-6)}`;

  try {
    return await createContactWithNumber({
      name,
      [field]: externalUserId,
    });
  } catch (err) {
    // Corrida: outro webhook criou o contato simultaneamente.
    if (isPrismaUniqueViolation(err)) {
      const won = await prisma.contact.findFirst({
        where: { [field]: externalUserId } as Prisma.ContactWhereInput,
        select: { id: true, name: true },
      });
      if (won) return won;
    }
    throw err;
  }
}

async function fetchProfileName(
  userId: string,
  hit: ChannelHit,
): Promise<string | null> {
  if (!hit.accessToken) return null;
  try {
    // Messenger: /{psid}?fields=name; Instagram: /{igsid}?fields=name
    const url = new URL(`${GRAPH_BASE}/${userId}`);
    url.searchParams.set("fields", "name");
    url.searchParams.set("access_token", hit.accessToken);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { name?: string };
    return data.name?.trim() || null;
  } catch {
    return null;
  }
}

async function createContactWithNumber(
  fields: Record<string, unknown>,
): Promise<{ id: string; name: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = await nextContactNumber();
    try {
      return await prisma.contact.create({
        data: withOrgFromCtx({ number, ...fields } as unknown as Prisma.ContactUncheckedCreateInput),
        select: { id: true, name: true },
      });
    } catch (err) {
      if (isPrismaUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new Error("createContactWithNumber: max retries excedidos");
}

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

// ── findOrCreateConversation ──────────────────────────────

async function findOrCreateConversation(
  contactId: string,
  platform: Platform,
  channelId: string,
): Promise<{ id: string }> {
  const channelSlug = platform;

  const findActive = () =>
    prisma.conversation.findFirst({
      where: { contactId, channel: channelSlug, status: { not: "RESOLVED" } },
      select: { id: true, channelId: true },
    });

  const existing = await findActive();
  if (existing) {
    if (existing.channelId !== channelId) {
      await prisma.conversation.update({
        where: { id: existing.id },
        data: { channelId },
      });
    }
    return { id: existing.id };
  }

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { assignedToId: true },
  });

  try {
    return await withConversationNumberRetry((number) =>
      prisma.conversation.create({
        data: withOrgFromCtx({
          number,
          contactId,
          channel: channelSlug,
          channelId,
          status: "OPEN" as const,
          ...(contact?.assignedToId ? { assignedToId: contact.assignedToId } : {}),
        }),
        select: { id: true },
      }),
    );
  } catch (err) {
    if (isActiveConversationUniqueViolation(err)) {
      const won = await findActive();
      if (won) return { id: won.id };
    }
    throw err;
  }
}
