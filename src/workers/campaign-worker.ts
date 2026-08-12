import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";

import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { withSystemContext } from "@/lib/webhook-context";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { botOutboundReplyMark } from "@/lib/conversation-reply-marking";
import { buildOutboundTemplateMessageContent } from "@/lib/whatsapp-outbound-template-label";
import {
  ensureWhatsAppConversationForContact,
  maybeResolveUnansweredOutboundTicket,
} from "@/services/whatsapp-conversation";
import {
  CAMPAIGN_DISPATCH_QUEUE_NAME,
  CAMPAIGN_SEND_QUEUE_NAME,
  type CampaignDispatchPayload,
  type CampaignSendPayload,
  enqueueCampaignSendBulk,
  enqueueAutomationJob,
  enqueueBaileysOutbound,
} from "@/lib/queue";
import { metaClientFromConfig, formatMetaSendError } from "@/lib/meta-whatsapp/client";
import { enrichTemplateComponentsForFlowSend } from "@/lib/meta-whatsapp/enrich-template-flow";
import { getDecryptedChannelConfig } from "@/lib/channels/config";
import { buildContactWhere, type SegmentFilters } from "@/services/segments";
import { metrics, safeLabel } from "@/lib/metrics";
import {
  extractMetaRetryCode,
  isInside24hWindow,
  shouldRetryCampaignSendError,
  isWindowExpiredError,
} from "@/services/campaign-builder/meta-compliance";
import {
  clampCampaignSendRate,
  getCampaignSendConcurrency,
  getCampaignSendRateMax,
} from "@/lib/campaign-send-rate";
import {
  flushCampaignCounters,
  incrementCampaignCounter,
} from "@/lib/campaign-counters";
import {
  buildFlowButtonComponent,
} from "@/lib/meta-whatsapp/enrich-template-flow";
import { randomUUID } from "node:crypto";

const BATCH_SIZE = 500;
const globalWorker = globalThis as unknown as {
  campaignThrottleRedis?: IORedis;
  campaignRowCache?: Map<string, { row: unknown; at: number }>;
};

/** Cache curto do row da campanha no processo do worker — evita 1
 * findUnique por destinatário (2k envios = 2k reads no PG compartilhado). */
const CAMPAIGN_ROW_CACHE_TTL_MS = 5_000;

type CampaignRow = Awaited<ReturnType<typeof loadCampaignRowUncached>>;

async function loadCampaignRowUncached(campaignId: string) {
  return prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { channel: { select: { id: true, provider: true, config: true } } },
  });
}

async function loadCampaignRow(campaignId: string): Promise<CampaignRow> {
  const cache = (globalWorker.campaignRowCache ??= new Map());
  const hit = cache.get(campaignId);
  if (hit && Date.now() - hit.at < CAMPAIGN_ROW_CACHE_TTL_MS) {
    return hit.row as CampaignRow;
  }
  const row = await loadCampaignRowUncached(campaignId);
  cache.set(campaignId, { row, at: Date.now() });
  return row;
}

// ── Template preparation cache ───────────────────────────
// Antes: por destinatário, 1 read PG (whatsAppTemplateConfig) + 1 chamada
// Meta Graph (GET template / listagem paginada) dentro de
// enrichTemplateComponentsForFlowSend. Em blast de 2k: 2k reads + 2k
// chamadas Graph. A definição do template não muda durante o disparo —
// resolvemos 1× por campanha e só regeneramos o flow_token (UUID) por
// destinatário, preservando a correlação por mensagem.

type PreparedTemplate = {
  templateConfigId: string | null;
  bodyPreview: string | null;
  category: string | null;
  /** Componentes base SEM o botão flow (undefined = sem componentes). */
  baseComponents: unknown[] | undefined;
  /** Índice do botão flow na definição; null = template sem flow. */
  flowIndex: string | null;
};

const PREPARED_TEMPLATE_TTL_MS = 60_000;

type PreparedCacheEntry = { prepared: PreparedTemplate; at: number };

function preparedTemplateCache(): Map<string, PreparedCacheEntry> {
  const g = globalWorker as unknown as {
    preparedTemplateCache?: Map<string, PreparedCacheEntry>;
  };
  return (g.preparedTemplateCache ??= new Map());
}

/** Remove o botão flow (probado com token descartável) e devolve o índice. */
function stripFlowButton(components: unknown[]): {
  base: unknown[];
  flowIndex: string | null;
} {
  const base: unknown[] = [];
  let flowIndex: string | null = null;
  for (const c of components) {
    const o = c && typeof c === "object" ? (c as Record<string, unknown>) : null;
    const type = String(o?.type ?? "").toLowerCase();
    const sub = String(
      o?.sub_type ?? (o as { subType?: string } | null)?.subType ?? "",
    ).toLowerCase();
    if (type === "button" && sub === "flow") {
      flowIndex = typeof o?.index === "string" ? o.index : String(o?.index ?? "0");
      continue;
    }
    base.push(c);
  }
  return { base, flowIndex };
}

async function prepareTemplateForCampaign(
  campaign: {
    id: string;
    templateName: string | null;
    templateLanguage: string | null;
    templateComponents: unknown;
  },
  client: ReturnType<typeof metaClientFromConfig>,
): Promise<PreparedTemplate> {
  const cache = preparedTemplateCache();
  const hit = cache.get(campaign.id);
  if (hit && Date.now() - hit.at < PREPARED_TEMPLATE_TTL_MS) return hit.prepared;

  if (!campaign.templateName) throw new Error("Template não definido na campanha.");
  const components = campaign.templateComponents
    ? (campaign.templateComponents as unknown[])
    : undefined;

  let templateGraphId: string | null = null;
  let templateConfigId: string | null = null;
  let bodyPreview: string | null = null;
  let category: string | null = null;
  try {
    const row = await prisma.whatsAppTemplateConfig.findFirst({
      where: { metaTemplateName: campaign.templateName },
      select: { id: true, metaTemplateId: true, bodyPreview: true, category: true },
    });
    templateGraphId = row?.metaTemplateId?.trim() || null;
    templateConfigId = row?.id ?? null;
    bodyPreview = row?.bodyPreview ?? null;
    category = row?.category ?? null;
  } catch {
    /* ignore */
  }

  const probe = await enrichTemplateComponentsForFlowSend(client, {
    templateName: campaign.templateName,
    languageCode: campaign.templateLanguage ?? "pt_BR",
    components,
    templateGraphId,
    // Token sonda — descartado; por destinatário geramos UUID novo.
    flowToken: randomUUID(),
  });

  let prepared: PreparedTemplate;
  if (probe.flowToken && probe.components) {
    const { base, flowIndex } = stripFlowButton(probe.components);
    prepared = {
      templateConfigId,
      bodyPreview,
      category,
      baseComponents: base.length ? base : undefined,
      flowIndex,
    };
  } else {
    prepared = {
      templateConfigId,
      bodyPreview,
      category,
      baseComponents: probe.components,
      flowIndex: null,
    };
  }
  cache.set(campaign.id, { prepared, at: Date.now() });
  return prepared;
}

/** Monta os componentes finais do envio, com flow_token fresco por destinatário. */
function buildSendComponents(prepared: PreparedTemplate): {
  components: unknown[] | undefined;
  flowToken: string | null;
} {
  if (prepared.flowIndex == null) {
    return { components: prepared.baseComponents, flowToken: null };
  }
  const token = randomUUID();
  const btn = buildFlowButtonComponent(prepared.flowIndex, token, null);
  return {
    components: [...(prepared.baseComponents ?? []), btn],
    flowToken: token,
  };
}

function getRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required for campaign worker");
  return url;
}

function getThrottleRedis(): IORedis {
  if (!globalWorker.campaignThrottleRedis) {
    globalWorker.campaignThrottleRedis = new IORedis(getRedisUrl(), {
      maxRetriesPerRequest: null,
    });
  }
  return globalWorker.campaignThrottleRedis;
}

async function waitForMetaThrottle(phoneNumberId: string, sendRate: number) {
  const redis = getThrottleRedis();
  // Defense-in-depth: clamp even if DB still has legacy sendRate=80.
  const rate = clampCampaignSendRate(sendRate);
  const intervalMs = Math.max(1, Math.ceil(1000 / rate));
  const now = Date.now();
  const key = `campaign:meta:throttle:${phoneNumberId}`;
  const slot = await redis.eval(
    `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local interval = tonumber(ARGV[2])
      local ttl = tonumber(ARGV[3])
      local nextTs = tonumber(redis.call("GET", key) or "0")
      if nextTs < now then nextTs = now end
      redis.call("SET", key, tostring(nextTs + interval), "PX", ttl)
      return nextTs
    `,
    1,
    key,
    String(now),
    String(intervalMs),
    String(Math.max(60_000, intervalMs * 5)),
  );
  const waitMs = Math.max(0, Number(slot) - now);
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

async function isWithinMetaWindow(contactId: string, channelId: string): Promise<boolean> {
  const latestInbound = await prisma.message.findFirst({
    where: {
      conversation: { contactId, channelId },
      direction: "in",
    },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return isInside24hWindow(latestInbound?.createdAt ?? null);
}

// ── Dispatch worker ──────────────────────────────────────

async function handleDispatch(payload: CampaignDispatchPayload) {
  const { campaignId } = payload;
  console.info(`[campaign-dispatch] Processing campaign ${campaignId}`);

  const campaign = await prismaBase.campaign.findUnique({
    where: { id: campaignId },
    include: { segment: true },
  });

  if (!campaign) {
    console.error(`[campaign-dispatch] Campaign ${campaignId} not found`);
    return;
  }
  const organizationId = campaign.organizationId;

  if (!["PROCESSING", "SCHEDULED"].includes(campaign.status)) {
    console.warn(`[campaign-dispatch] Campaign ${campaignId} status is ${campaign.status}, skipping`);
    return;
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "PROCESSING" },
  });

  try {
    const filters: SegmentFilters = campaign.segment
      ? (campaign.segment.filters as unknown as SegmentFilters)
      : (campaign.filters as unknown as SegmentFilters) ?? {};

    const where = buildContactWhere(filters);
    where.phone = { not: null };

    const contacts = await prisma.contact.findMany({
      where,
      select: { id: true, phone: true, whatsappBsuid: true },
    });

    if (contacts.length === 0) {
      console.warn(`[campaign-dispatch] No contacts for campaign ${campaignId}`);
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: "COMPLETED", totalRecipients: 0, completedAt: new Date() },
      });
      return;
    }

    let enqueued = 0;
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      const batch = contacts.slice(i, i + BATCH_SIZE);
      await prisma.campaignRecipient.createMany({
        data: batch.map((c) => ({
          organizationId,
          campaignId,
          contactId: c.id,
          status: "PENDING" as const,
        })),
        skipDuplicates: true,
      });

      // 1 findMany + addBulk por lote — evita N× (findUnique + queue.add)
      // que gerava storm de Redis/DB no início do disparo (~2k destinatários).
      const recipients = await prisma.campaignRecipient.findMany({
        where: {
          campaignId,
          contactId: { in: batch.map((c) => c.id) },
        },
        select: { id: true, contactId: true },
      });
      const contactById = new Map(batch.map((c) => [c.id, c]));
      const payloads = recipients.flatMap((r) => {
        const contact = contactById.get(r.contactId);
        if (!contact?.phone) return [];
        return [
          {
            campaignId,
            recipientId: r.id,
            contactId: r.contactId,
            contactPhone: contact.phone,
            contactBsuid: contact.whatsappBsuid ?? undefined,
          },
        ];
      });
      const jobs = await enqueueCampaignSendBulk(payloads);
      if (!jobs) {
        throw new Error("Fila campaign-send indisponível (Redis) durante dispatch");
      }
      enqueued += payloads.length;
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: "SENDING",
        totalRecipients: contacts.length,
        startedAt: new Date(),
      },
    });

    console.info(`[campaign-dispatch] Enqueued ${enqueued} send jobs for campaign ${campaignId}`);
  } catch (err) {
    console.error(`[campaign-dispatch] Error dispatching campaign ${campaignId}:`, err);
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "FAILED", completedAt: new Date() },
    });
  }
}

// ── Send worker ──────────────────────────────────────────

async function handleSend(
  payload: CampaignSendPayload,
  job: Job<CampaignSendPayload>,
) {
  const { campaignId, recipientId, contactId, contactPhone, contactBsuid } = payload;

  // Cache curto (5s) — sem isso cada destinatário relê a campanha.
  const campaign = await loadCampaignRow(campaignId);

  if (!campaign) return;

  if (campaign.status === "PAUSED" || campaign.status === "CANCELLED") {
    console.info(`[campaign-send] Campaign ${campaignId} is ${campaign.status}, skipping recipient ${recipientId}`);
    return;
  }

  await prisma.campaignRecipient.update({
    where: { id: recipientId },
    data: { status: "SENDING" },
  });

  try {
    const provider = campaign.channel.provider;
    const config = getDecryptedChannelConfig({
      provider: campaign.channel.provider,
      config: campaign.channel.config,
    });

    if (campaign.type === "AUTOMATION") {
      if (campaign.automationId) {
        await enqueueAutomationJob({
          automationId: campaign.automationId,
          context: {
            contactId,
            event: "campaign_trigger",
            // channelId: canal escolhido no wizard da campanha. Sem ele o
            // executor resolvia pela conversa do contato — que pode estar
            // num canal DISCONNECTED (token invalidado pela Meta), falhando
            // o disparo em massa. O executor lê em `rt.activeChannelId`.
            data: { campaignId, recipientId, channelId: campaign.channelId },
          },
        });
      }
      await markRecipientSent(recipientId, campaignId);
      return;
    }

    if (provider === "META_CLOUD_API") {
      await sendViaMetaCloudApi(campaign, config, contactPhone, contactBsuid, recipientId, campaignId, contactId);
    } else if (provider === "BAILEYS_MD") {
      await sendViaBaileys(campaign, contactPhone, contactId, recipientId, campaignId);
    } else {
      throw new Error(`Provider ${provider} não suportado para campanhas.`);
    }
    metrics.messages.outbound.inc({
      channel_provider: provider,
      status: "accepted",
      organization: safeLabel(campaign.organizationId),
    });
  } catch (err) {
    const errorMsg = formatMetaSendError(err);
    console.error(`[campaign-send] Error for recipient ${recipientId}:`, errorMsg);
    const metaCode = extractMetaRetryCode(errorMsg);
    const maxAttempts = Math.max(1, Number(job.opts.attempts ?? 1));
    const shouldRetry = shouldRetryCampaignSendError(
      errorMsg,
      job.attemptsMade,
      maxAttempts,
    );
    const windowExpired = isWindowExpiredError(errorMsg);

    if (shouldRetry) {
      await prisma.campaignRecipient.update({
        where: { id: recipientId },
        data: { status: "PENDING", errorMessage: `Retryable Meta error (${metaCode})` },
      });
      metrics.messages.outbound.inc({
        channel_provider: "META_CLOUD_API",
        status: "retryable_failed",
        organization: safeLabel(campaign.organizationId),
      });
      metrics.errors.inc({
        scope: "campaign.meta.retryable",
        kind: String(metaCode),
      });
      console.warn(
        `[campaign-send][ALERTA] Retryable Meta error code=${metaCode} campaign=${campaignId} recipient=${recipientId}`,
      );
      throw err;
    }

    // Update condicional (status != FAILED) para evitar double-count caso o
    // webhook Meta `failed` já tenha marcado este destinatário como FAILED.
    const failedUpdate = await prisma.campaignRecipient.updateMany({
      where: { id: recipientId, status: { not: "FAILED" } },
      data: {
        status: "FAILED",
        errorMessage: windowExpired
          ? "Fora da janela de 24h da Meta. Use template aprovado."
          : errorMsg,
      },
    });
    if (failedUpdate.count > 0) {
      incrementCampaignCounter(campaignId, "failedCount");
    }
    metrics.messages.outbound.inc({
      channel_provider: campaign.channel.provider,
      status: "failed",
      organization: safeLabel(campaign.organizationId),
    });

    await checkCampaignCompletion(campaignId);
  }
}

async function sendViaMetaCloudApi(
  campaign: {
    id: string;
    name: string;
    organizationId: string;
    type: string;
    templateName: string | null;
    templateLanguage: string | null;
    templateComponents: unknown;
    textContent: string | null;
    sendRate: number;
    channel: { id: string };
  },
  config: Record<string, unknown>,
  phone: string,
  bsuid: string | undefined,
  recipientId: string,
  campaignId: string,
  contactId: string,
) {
  // Nunca montar cliente Meta manualmente via `config.accessToken`; usar
  // metaClientFromConfig para garantir decrypt/back-compat centralizados.
  const client = metaClientFromConfig(config);

  if (!client.configured) {
    throw new Error("Canal Meta Cloud API não configurado (token ou phone number ID ausente).");
  }
  const phoneNumberId =
    typeof config.phoneNumberId === "string" && config.phoneNumberId.trim().length > 0
      ? config.phoneNumberId.trim()
      : "unknown";
  await waitForMetaThrottle(phoneNumberId, campaign.sendRate);

  let metaMessageId: string | null = null;
  let messageType: "template" | "text" = "text";
  let content = "";
  let templateConfigId: string | null = null;
  let flowToken: string | null = null;

  if (campaign.type === "TEMPLATE") {
    const prepared = await prepareTemplateForCampaign(campaign, client);
    templateConfigId = prepared.templateConfigId;
    const built = buildSendComponents(prepared);
    flowToken = built.flowToken;
    const result = await client.sendTemplate(
      phone,
      campaign.templateName!,
      campaign.templateLanguage ?? "pt_BR",
      built.components,
      bsuid,
    );
    metaMessageId = result.messages?.[0]?.id ?? null;
    messageType = "template";
    content = buildOutboundTemplateMessageContent(
      campaign.templateName!,
      "generic",
      prepared.category,
      prepared.bodyPreview,
    );
  } else if (campaign.type === "TEXT") {
    if (!campaign.textContent) throw new Error("Conteúdo de texto não definido na campanha.");
    const withinWindow = await isWithinMetaWindow(contactId, campaign.channel.id);
    if (!withinWindow) {
      throw new Error("META_WINDOW_EXPIRED_24H");
    }
    const result = await client.sendText(phone, campaign.textContent, bsuid);
    metaMessageId = result.messages?.[0]?.id ?? null;
    messageType = "text";
    content = campaign.textContent;
  }

  await prisma.campaignRecipient.update({
    where: { id: recipientId },
    data: { status: "SENT", sentAt: new Date(), metaMessageId },
  });
  incrementCampaignCounter(campaignId, "sentCount");

  // Grava no chat (Message) — sem isso a campanha some do histórico do inbox.
  try {
    await persistCampaignOutboundMessage({
      contactId,
      channelId: campaign.channel.id,
      campaignName: campaign.name,
      content,
      messageType,
      externalId: metaMessageId,
      templateConfigId,
      flowToken,
    });
  } catch (err) {
    console.error(
      `[campaign-send] Falha ao gravar Message no chat (envio Meta ok) recipient=${recipientId}:`,
      err instanceof Error ? err.message : err,
    );
  }

  await checkCampaignCompletion(campaignId);
}

/**
 * Garante conversa OPEN e grava a mensagem outbound da campanha no histórico.
 * Idempotente por `externalId` (wamid Meta).
 */
async function persistCampaignOutboundMessage(input: {
  contactId: string;
  channelId: string;
  campaignName: string;
  content: string;
  messageType: "template" | "text";
  externalId: string | null;
  templateConfigId?: string | null;
  flowToken?: string | null;
  createdAt?: Date;
  sendStatus?: string;
}) {
  if (input.externalId) {
    const existing = await prisma.message.findFirst({
      where: { externalId: input.externalId },
      select: { id: true },
    });
    if (existing) return existing.id;
  }

  const ensured = await ensureWhatsAppConversationForContact(input.contactId, {
    // Campanha TEMPLATE/TEXT: ticket novo só pra histórico do disparo — sem
    // herdar dono (Entrada). Auto-resolve abaixo fecha o ticket em seguida.
    inheritAssignee: false,
  });
  if (
    ensured.status === "skipped_contact_missing" ||
    ensured.status === "skipped_no_channel" ||
    ensured.status === "skipped_no_phone"
  ) {
    console.warn(
      `[campaign-send] Sem conversa para contact=${input.contactId} status=${ensured.status}`,
    );
    return null;
  }

  const conversationId = ensured.conversationId;
  const channelId = ensured.channelId ?? input.channelId;

  const saved = await prisma.message.create({
    data: withOrgFromCtx({
      conversationId,
      content: input.content || `[Campanha: ${input.campaignName}]`,
      direction: "out",
      messageType: input.messageType,
      authorType: "bot" as const,
      senderName: `Campanha: ${input.campaignName}`,
      sendStatus: input.sendStatus ?? "sent",
      ...(input.externalId ? { externalId: input.externalId } : {}),
      ...(input.templateConfigId ? { templateConfigId: input.templateConfigId } : {}),
      ...(input.flowToken ? { flowToken: input.flowToken } : {}),
      ...(channelId ? { channelId } : {}),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    }),
  });

  // Modelo de ticket para campanhas: após gravar o disparo, fecha o ticket
  // se o aluno ainda não respondeu (`lastInboundAt` null). Cobre tanto
  // `ensured=created` quanto reuso de OPEN órfão (`already_ok` /
  // `backfilled_channel`) — regressão 2026-08-11: campanha "teste 1108"
  // reaproveitou ticket vazio e ficou em Entrada porque só `created`
  // auto-resolvia.
  //
  // Se o contato já tinha atendimento com inbound, NÃO fecha — a mensagem
  // entra no chat aberto normalmente.
  await prisma.conversation
    .update({
      where: { id: conversationId },
      data: {
        updatedAt: new Date(),
        ...(await botOutboundReplyMark()),
      },
    })
    .catch(() => {});
  await maybeResolveUnansweredOutboundTicket(conversationId).catch(() => {});

  // NÃO publicar SSE `new_message` em blast de campanha.
  // Cada publish → Redis pub/sub → todos os clientes da org → invalidate
  // inbox/board (scheduleBoardInvalidation). Em ~2k envios isso vira
  // stampede de GET /api/conversations e satura a API/Postgres compartilhado.
  // A mensagem permanece no histórico; o operador vê ao abrir o ticket.

  return saved.id;
}

async function sendViaBaileys(
  campaign: { textContent: string | null; channel: { id: string } },
  phone: string,
  contactId: string,
  recipientId: string,
  campaignId: string,
) {
  if (!campaign.textContent) throw new Error("Conteúdo de texto não definido na campanha.");

  const conv = await prisma.conversation.findFirst({
    where: { contactId, channel: "whatsapp", waJid: { not: null } },
    select: { waJid: true },
  });
  const to = conv?.waJid ?? phone;

  await enqueueBaileysOutbound({
    channelId: campaign.channel.id,
    to,
    content: campaign.textContent,
    messageType: "text",
    conversationId: "",
    messageId: "",
  });

  await markRecipientSent(recipientId, campaignId);
}

async function markRecipientSent(recipientId: string, campaignId: string) {
  await prisma.campaignRecipient.update({
    where: { id: recipientId },
    data: { status: "SENT", sentAt: new Date() },
  });
  incrementCampaignCounter(campaignId, "sentCount");
  await checkCampaignCompletion(campaignId);
}

async function checkCampaignCompletion(campaignId: string) {
  // Amostra 1/N — evita 1 read por destinatário só pra checar se acabou.
  // O residual (últimos N-1) é coberto pelo sweep periódico no dispatch.
  const n = envPositiveInt("CAMPAIGN_COMPLETION_CHECK_EVERY", 25);
  if (Math.floor(Math.random() * n) !== 0) return;
  await checkCampaignCompletionNow(campaignId);
}

async function checkCampaignCompletionNow(campaignId: string) {
  // Contadores são bufferizados (campaign-counters) — flusha antes de ler,
  // senão o check de conclusão enxerga valores defasados.
  await flushCampaignCounters(campaignId);
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { totalRecipients: true, sentCount: true, failedCount: true, status: true },
  });
  if (!campaign || campaign.status !== "SENDING") return;

  const processed = campaign.sentCount + campaign.failedCount;
  if (processed >= campaign.totalRecipients) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    console.info(`[campaign-send] Campaign ${campaignId} completed: ${campaign.sentCount} sent, ${campaign.failedCount} failed`);
  }
}

// ── Bootstrap ────────────────────────────────────────────

function envPositiveInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultValue;
}

/** orgId por campanha — sem TTL longo porque campanha não troca de org. */
async function resolveCampaignOrgId(campaignId: string): Promise<string | null> {
  const g = globalWorker as unknown as {
    campaignOrgCache?: Map<string, string | null>;
  };
  const cache = (g.campaignOrgCache ??= new Map());
  if (cache.has(campaignId)) return cache.get(campaignId) ?? null;
  const camp = await prismaBase.campaign.findUnique({
    where: { id: campaignId },
    select: { organizationId: true },
  });
  const orgId = camp?.organizationId ?? null;
  // Não cachear miss — campanha pode ter sido criada depois do enqueue.
  if (orgId) cache.set(campaignId, orgId);
  return orgId;
}

export function startCampaignWorkers() {
  const redisUrl = getRedisUrl();
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  // Rate limit global do BullMQ (msgs / duration). Teto adicional além do
  // throttle por phoneNumberId (`campaign:meta:throttle:...`). Capado por
  // CAMPAIGN_SEND_RATE_MAX para não saturar PG/API mesmo se o tier Meta
  // permitir mais. Ops pode subir WHATSAPP_RATE_LIMIT_MAX e
  // CAMPAIGN_SEND_RATE_MAX juntos se a infra aguentar.
  const rateLimitMax = Math.min(
    envPositiveInt("WHATSAPP_RATE_LIMIT_MAX", 80),
    getCampaignSendRateMax(),
  );
  const rateLimitDuration = envPositiveInt(
    "WHATSAPP_RATE_LIMIT_DURATION",
    1000,
  );
  const sendConcurrency = getCampaignSendConcurrency();

  /**
   * Workers BullMQ rodam fora de qualquer request handler — sem session
   * NextAuth e sem AsyncLocalStorage. A `prisma` com a extensao de scope
   * exige RequestContext, entao precisamos resolver a org do job (sem
   * scope, via prismaBase) e wrappear a execucao em `withSystemContext`.
   * Sem isso, todas as queries `prisma.*` dentro do handler quebram com
   * "chamado fora de RequestContext" — ou, pior, em ambientes legados,
   * rodam sem filtro de tenant.
   */
  const dispatchWorker = new Worker<CampaignDispatchPayload>(
    CAMPAIGN_DISPATCH_QUEUE_NAME,
    async (job) => {
      const camp = await prismaBase.campaign.findUnique({
        where: { id: job.data.campaignId },
        select: { organizationId: true },
      });
      if (!camp) {
        console.warn(`[campaign-dispatch] Campaign ${job.data.campaignId} não encontrada`);
        return;
      }
      await withSystemContext(camp.organizationId, () => handleDispatch(job.data));
    },
    { connection, concurrency: 2 },
  );

  const sendWorker = new Worker<CampaignSendPayload>(
    CAMPAIGN_SEND_QUEUE_NAME,
    async (job: Job<CampaignSendPayload>) => {
      // orgId da campanha não muda — cache por processo evita 1 read PG por
      // job (2k destinatários = 2k reads só pra resolver tenant).
      const orgId = await resolveCampaignOrgId(job.data.campaignId);
      if (!orgId) {
        console.warn(`[campaign-send] Campaign ${job.data.campaignId} não encontrada`);
        return;
      }
      await withSystemContext(orgId, () => handleSend(job.data, job));
    },
    {
      connection: connection.duplicate(),
      concurrency: sendConcurrency,
      limiter: { max: rateLimitMax, duration: rateLimitDuration },
    },
  );

  dispatchWorker.on("failed", (job, err) => {
    console.error(`[campaign-dispatch] Job ${job?.id} failed:`, err.message);
  });

  sendWorker.on("failed", (job, err) => {
    console.error(`[campaign-send] Job ${job?.id} failed:`, err.message);
  });

  console.info(
    `[campaign-worker] Dispatch and send workers started (sendConcurrency=${sendConcurrency}, rateLimit=${rateLimitMax}/${rateLimitDuration}ms, sendRateMax=${getCampaignSendRateMax()})`,
  );

  return { dispatchWorker, sendWorker };
}

if (require.main === module) {
  startCampaignWorkers();
}
