import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";

import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { withSystemContext } from "@/lib/webhook-context";
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
            data: { campaignId, recipientId },
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

    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: {
        status: "FAILED",
        errorMessage: windowExpired
          ? "Fora da janela de 24h da Meta. Use template aprovado."
          : errorMsg,
      },
    });
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { failedCount: { increment: 1 } },
    });
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

  if (campaign.type === "TEMPLATE") {
    if (!campaign.templateName) throw new Error("Template não definido na campanha.");
    const components = campaign.templateComponents
      ? (campaign.templateComponents as unknown[])
      : undefined;
    let templateGraphId: string | null = null;
    try {
      const row = await prisma.whatsAppTemplateConfig.findFirst({
        where: { metaTemplateName: campaign.templateName },
        select: { metaTemplateId: true },
      });
      templateGraphId = row?.metaTemplateId?.trim() || null;
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
    void campaignFlowToken; // Campanhas não criam `Message`; token só no payload Cloud API (ver logs [meta-flow-enrich]).
    const result = await client.sendTemplate(
      phone,
      campaign.templateName,
      campaign.templateLanguage ?? "pt_BR",
      sendComponents,
      bsuid,
    );
    metaMessageId = result.messages?.[0]?.id ?? null;
  } else if (campaign.type === "TEXT") {
    if (!campaign.textContent) throw new Error("Conteúdo de texto não definido na campanha.");
    const withinWindow = await isWithinMetaWindow(contactId, campaign.channel.id);
    if (!withinWindow) {
      throw new Error("META_WINDOW_EXPIRED_24H");
    }
    const result = await client.sendText(phone, campaign.textContent, bsuid);
    metaMessageId = result.messages?.[0]?.id ?? null;
  }

  await prisma.campaignRecipient.update({
    where: { id: recipientId },
    data: { status: "SENT", sentAt: new Date(), metaMessageId },
  });
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { sentCount: { increment: 1 } },
  });
  await checkCampaignCompletion(campaignId);
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

export function startCampaignWorkers() {
  const redisUrl = getRedisUrl();
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

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
      limiter: { max: 80, duration: 1000 },
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
