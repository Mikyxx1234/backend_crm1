import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";

import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { withSystemContext } from "@/lib/webhook-context";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { getOrgIdOrNull } from "@/lib/request-context";
import { botOutboundReplyMark } from "@/lib/conversation-reply-marking";
import { sseBus } from "@/lib/sse-bus";
import { buildOutboundTemplateMessageContent } from "@/lib/whatsapp-outbound-template-label";
import { ensureWhatsAppConversationForContact } from "@/services/whatsapp-conversation";
import {
  CAMPAIGN_DISPATCH_QUEUE_NAME,
  CAMPAIGN_SEND_QUEUE_NAME,
  type CampaignDispatchPayload,
  type CampaignSendPayload,
  enqueueCampaignSend,
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

const BATCH_SIZE = 500;
const globalWorker = globalThis as unknown as { campaignThrottleRedis?: IORedis };

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
  const rate = Math.max(1, Math.min(80, sendRate));
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
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: "SENDING",
        totalRecipients: contacts.length,
        startedAt: new Date(),
      },
    });

    for (const contact of contacts) {
      const recipient = await prisma.campaignRecipient.findUnique({
        where: { campaignId_contactId: { campaignId, contactId: contact.id } },
        select: { id: true },
      });
      if (!recipient) continue;

      await enqueueCampaignSend({
        campaignId,
        recipientId: recipient.id,
        contactId: contact.id,
        contactPhone: contact.phone!,
        contactBsuid: contact.whatsappBsuid ?? undefined,
      });
    }

    console.info(`[campaign-dispatch] Enqueued ${contacts.length} send jobs for campaign ${campaignId}`);
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

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      channel: { select: { id: true, provider: true, config: true } },
    },
  });

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
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { failedCount: { increment: 1 } },
      });
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
    if (!campaign.templateName) throw new Error("Template não definido na campanha.");
    const components = campaign.templateComponents
      ? (campaign.templateComponents as unknown[])
      : undefined;
    let templateGraphId: string | null = null;
    let bodyPreview: string | null = null;
    let category: string | null = null;
    try {
      const row = await prisma.whatsAppTemplateConfig.findFirst({
        where: { metaTemplateName: campaign.templateName },
        select: {
          id: true,
          metaTemplateId: true,
          bodyPreview: true,
          category: true,
        },
      });
      templateGraphId = row?.metaTemplateId?.trim() || null;
      templateConfigId = row?.id ?? null;
      bodyPreview = row?.bodyPreview ?? null;
      category = row?.category ?? null;
    } catch {
      /* ignore */
    }
    const { components: sendComponents, flowToken: campaignFlowToken } =
      await enrichTemplateComponentsForFlowSend(client, {
        templateName: campaign.templateName,
        languageCode: campaign.templateLanguage ?? "pt_BR",
        components,
        templateGraphId,
      });
    flowToken =
      typeof campaignFlowToken === "string" && campaignFlowToken.trim()
        ? campaignFlowToken.trim()
        : null;
    const result = await client.sendTemplate(
      phone,
      campaign.templateName,
      campaign.templateLanguage ?? "pt_BR",
      sendComponents,
      bsuid,
    );
    metaMessageId = result.messages?.[0]?.id ?? null;
    messageType = "template";
    content = buildOutboundTemplateMessageContent(
      campaign.templateName,
      "generic",
      category,
      bodyPreview,
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
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { sentCount: { increment: 1 } },
  });

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

  // Modelo de ticket para campanhas: se a conversa foi CRIADA agora só pra
  // registrar o disparo (contato não tinha conversa OPEN no momento), a
  // fechamos imediatamente após gravar a mensagem. Assim o histórico do
  // envio fica preservado, mas o inbox NÃO recebe uma "Entrada" fantasma
  // — a conversa só aparecerá quando o cliente responder (o webhook Meta
  // em `findOrCreateConversation` cria nova conversa OPEN para inbound
  // sobre contato só com RESOLVED — comportamento já implementado).
  //
  // Se `ensured.status === "already_ok"` (contato tinha atendimento em
  // curso) NÃO fechamos — a mensagem entra no chat aberto normalmente.
  // Incidente: campanha 2026-08-06 gerou 1660 conversas fantasma no inbox
  // da Cruzeiro EaD porque toda conversa ensured=created ficava OPEN sem
  // resposta do cliente (herdando ainda o `assignedToId` do contato).
  const shouldAutoResolve = ensured.status === "created";
  await prisma.conversation
    .update({
      where: { id: conversationId },
      data: {
        updatedAt: new Date(),
        ...(await botOutboundReplyMark()),
        ...(shouldAutoResolve
          ? {
              status: "RESOLVED" as const,
              closedAt: new Date(),
              assignedToId: null,
            }
          : {}),
      },
    })
    .catch(() => {});

  sseBus.publish("new_message", {
    organizationId: getOrgIdOrNull(),
    conversationId,
    contactId: input.contactId,
    direction: "out",
    content: saved.content,
    timestamp: saved.createdAt,
  });

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
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { sentCount: { increment: 1 } },
  });
  await checkCampaignCompletion(campaignId);
}

async function checkCampaignCompletion(campaignId: string) {
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

export function startCampaignWorkers() {
  const redisUrl = getRedisUrl();
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  // Rate limit do envio Meta — configurável por env para permitir afinar
  // sem rebuild. Defaults preservam o comportamento histórico (80/s, que
  // é o limite tier base da Meta Cloud API; clients com tier maior podem
  // subir essa configuração).
  const rateLimitMax = envPositiveInt("WHATSAPP_RATE_LIMIT_MAX", 80);
  const rateLimitDuration = envPositiveInt(
    "WHATSAPP_RATE_LIMIT_DURATION",
    1000,
  );

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
      const camp = await prismaBase.campaign.findUnique({
        where: { id: job.data.campaignId },
        select: { organizationId: true },
      });
      if (!camp) {
        console.warn(`[campaign-send] Campaign ${job.data.campaignId} não encontrada`);
        return;
      }
      await withSystemContext(camp.organizationId, () => handleSend(job.data, job));
    },
    {
      connection: connection.duplicate(),
      concurrency: 10,
      limiter: { max: rateLimitMax, duration: rateLimitDuration },
    },
  );

  dispatchWorker.on("failed", (job, err) => {
    console.error(`[campaign-dispatch] Job ${job?.id} failed:`, err.message);
  });

  sendWorker.on("failed", (job, err) => {
    console.error(`[campaign-send] Job ${job?.id} failed:`, err.message);
  });

  console.info("[campaign-worker] Dispatch and send workers started");

  return { dispatchWorker, sendWorker };
}

if (require.main === module) {
  startCampaignWorkers();
}
