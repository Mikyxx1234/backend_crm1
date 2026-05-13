import { Worker } from "bullmq";
import IORedis from "ioredis";

import { prisma } from "@/lib/prisma";
import {
  CAMPAIGN_DISPATCH_QUEUE_NAME,
  CAMPAIGN_SEND_QUEUE_NAME,
  type CampaignDispatchPayload,
  type CampaignSendPayload,
  enqueueCampaignSend,
  enqueueAutomationJob,
  enqueueBaileysOutbound,
} from "@/lib/queue";
import { MetaWhatsAppClient, formatMetaSendError } from "@/lib/meta-whatsapp/client";
import { buildContactWhere, type SegmentFilters } from "@/services/segments";

const BATCH_SIZE = 500;

function getRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required for campaign worker");
  return url;
}

/**
 * Build a per-channel MetaWhatsAppClient from stored channel config.
 */
function buildMetaClient(config: Record<string, unknown>): MetaWhatsAppClient {
  const token = String(config.accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN ?? "");
  const phoneId = String(config.phoneNumberId ?? process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? "");
  const wabaId = String(config.businessAccountId ?? process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID ?? "");
  return new MetaWhatsAppClient(token, phoneId, wabaId);
}

// ── Dispatch worker ──────────────────────────────────────

async function handleDispatch(payload: CampaignDispatchPayload) {
  const { campaignId } = payload;
  console.info(`[campaign-dispatch] Processing campaign ${campaignId}`);

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { segment: true },
  });

  if (!campaign) {
    console.error(`[campaign-dispatch] Campaign ${campaignId} not found`);
    return;
  }

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

async function handleSend(payload: CampaignSendPayload) {
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
    const config = (campaign.channel.config ?? {}) as Record<string, unknown>;

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
      await sendViaMetaCloudApi(campaign, config, contactPhone, contactBsuid, recipientId, campaignId);
    } else if (provider === "BAILEYS_MD") {
      await sendViaBaileys(campaign, contactPhone, contactId, recipientId, campaignId);
    } else {
      throw new Error(`Provider ${provider} não suportado para campanhas.`);
    }
  } catch (err) {
    const errorMsg = formatMetaSendError(err);
    console.error(`[campaign-send] Error for recipient ${recipientId}:`, errorMsg);

    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: { status: "FAILED", errorMessage: errorMsg },
    });
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { failedCount: { increment: 1 } },
    });

    await checkCampaignCompletion(campaignId);

    if (isRateLimitError(errorMsg)) {
      throw err;
    }
  }
}

async function sendViaMetaCloudApi(
  campaign: { type: string; templateName: string | null; templateLanguage: string | null; templateComponents: unknown; textContent: string | null },
  config: Record<string, unknown>,
  phone: string,
  bsuid: string | undefined,
  recipientId: string,
  campaignId: string,
) {
  const client = buildMetaClient(config);

  if (!client.configured) {
    throw new Error("Canal Meta Cloud API não configurado (token ou phone number ID ausente).");
  }

  let metaMessageId: string | null = null;

  if (campaign.type === "TEMPLATE") {
    if (!campaign.templateName) throw new Error("Template não definido na campanha.");
    const components = campaign.templateComponents
      ? (campaign.templateComponents as unknown[])
      : undefined;
    const result = await client.sendTemplate(
      phone,
      campaign.templateName,
      campaign.templateLanguage ?? "pt_BR",
      components,
      bsuid,
    );
    metaMessageId = result.messages?.[0]?.id ?? null;
  } else if (campaign.type === "TEXT") {
    if (!campaign.textContent) throw new Error("Conteúdo de texto não definido na campanha.");
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

function isRateLimitError(msg: string): boolean {
  return msg.includes("130429") || msg.includes("rate") || msg.includes("throttl");
}

// ── Bootstrap ────────────────────────────────────────────

export function startCampaignWorkers() {
  const redisUrl = getRedisUrl();
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  const dispatchWorker = new Worker<CampaignDispatchPayload>(
    CAMPAIGN_DISPATCH_QUEUE_NAME,
    async (job) => handleDispatch(job.data),
    { connection, concurrency: 2 },
  );

  const sendWorker = new Worker<CampaignSendPayload>(
    CAMPAIGN_SEND_QUEUE_NAME,
    async (job) => handleSend(job.data),
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
