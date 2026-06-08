import type {
  CampaignStatus,
  CampaignType,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import type { SegmentFilters } from "./segments";

export type GetCampaignsParams = {
  status?: CampaignStatus;
  type?: CampaignType;
  page?: number;
  perPage?: number;
};

export async function getCampaigns(params: GetCampaignsParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(100, Math.max(1, params.perPage ?? 20));
  const skip = (page - 1) * perPage;

  const where: Prisma.CampaignWhereInput = {};
  if (params.status) where.status = params.status;
  if (params.type) where.type = params.type;

  const [items, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { createdAt: "desc" },
      include: {
        channel: { select: { id: true, name: true, provider: true } },
        segment: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    }),
    prisma.campaign.count({ where }),
  ]);

  return { items, total, page, perPage, totalPages: Math.ceil(total / perPage) || 1 };
}

export async function getCampaignById(id: string) {
  return prisma.campaign.findUnique({
    where: { id },
    include: {
      channel: { select: { id: true, name: true, provider: true, type: true, config: true } },
      segment: { select: { id: true, name: true } },
      automation: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });
}

export type CreateCampaignInput = {
  name: string;
  type: CampaignType;
  channelId: string;
  segmentId?: string;
  filters?: SegmentFilters;
  templateName?: string;
  templateLanguage?: string;
  templateComponents?: unknown;
  textContent?: string;
  automationId?: string;
  sendRate?: number;
  scheduledAt?: Date;
  createdById: string;
};

export async function createCampaign(input: CreateCampaignInput) {
  return prisma.campaign.create({
    data: withOrgFromCtx({
      name: input.name,
      type: input.type,
      channelId: input.channelId,
      segmentId: input.segmentId ?? null,
      filters: input.filters
        ? (input.filters as unknown as Prisma.InputJsonValue)
        : undefined,
      templateName: input.templateName,
      templateLanguage: input.templateLanguage,
      templateComponents: input.templateComponents
        ? (input.templateComponents as Prisma.InputJsonValue)
        : undefined,
      textContent: input.textContent,
      automationId: input.automationId ?? null,
      sendRate: input.sendRate ?? 80,
      scheduledAt: input.scheduledAt ?? null,
      createdById: input.createdById,
    }),
  });
}

export async function updateCampaign(
  id: string,
  data: Partial<Omit<CreateCampaignInput, "createdById">>,
) {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw new Error("Campanha não encontrada.");
  if (campaign.status !== "DRAFT") throw new Error("Só campanhas em rascunho podem ser editadas.");

  const patch: Prisma.CampaignUpdateInput = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.type !== undefined) patch.type = data.type;
  if (data.channelId !== undefined) patch.channel = { connect: { id: data.channelId } };
  if (data.segmentId !== undefined)
    patch.segment = data.segmentId ? { connect: { id: data.segmentId } } : { disconnect: true };
  if (data.filters !== undefined)
    patch.filters = data.filters as unknown as Prisma.InputJsonValue;
  if (data.templateName !== undefined) patch.templateName = data.templateName;
  if (data.templateLanguage !== undefined) patch.templateLanguage = data.templateLanguage;
  if (data.templateComponents !== undefined)
    patch.templateComponents = data.templateComponents as Prisma.InputJsonValue;
  if (data.textContent !== undefined) patch.textContent = data.textContent;
  if (data.automationId !== undefined)
    patch.automation = data.automationId
      ? { connect: { id: data.automationId } }
      : { disconnect: true };
  if (data.sendRate !== undefined) patch.sendRate = data.sendRate;
  if (data.scheduledAt !== undefined) patch.scheduledAt = data.scheduledAt;

  return prisma.campaign.update({ where: { id }, data: patch });
}

export async function deleteCampaign(id: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw new Error("Campanha não encontrada.");
  if (!["DRAFT", "COMPLETED", "CANCELLED", "FAILED"].includes(campaign.status)) {
    throw new Error("Campanhas ativas não podem ser excluídas.");
  }
  return prisma.campaign.delete({ where: { id } });
}

export async function updateCampaignStatus(id: string, status: CampaignStatus) {
  const extra: Prisma.CampaignUpdateInput = { status };
  if (status === "SENDING") extra.startedAt = new Date();
  if (status === "COMPLETED" || status === "CANCELLED" || status === "FAILED")
    extra.completedAt = new Date();
  return prisma.campaign.update({ where: { id }, data: extra });
}

export async function getCampaignStats(id: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: {
      totalRecipients: true,
      sentCount: true,
      deliveredCount: true,
      failedCount: true,
      readCount: true,
      repliedCount: true,
      status: true,
      startedAt: true,
      completedAt: true,
    },
  });
  if (!campaign) throw new Error("Campanha não encontrada.");

  const pendingCount =
    campaign.totalRecipients - campaign.sentCount - campaign.failedCount;

  // Top motivos de falha (agrupado por errorMessage) para a UI de monitoramento.
  const failureGroups = await prisma.campaignRecipient.groupBy({
    by: ["errorMessage"],
    where: { campaignId: id, status: "FAILED" },
    _count: { _all: true },
    orderBy: { _count: { errorMessage: "desc" } },
    take: 10,
  });
  const failureReasons = failureGroups.map((g) => ({
    reason: g.errorMessage ?? "Desconhecido",
    count: g._count._all,
  }));

  const pct = (n: number) =>
    campaign.sentCount > 0 ? Math.round((n / campaign.sentCount) * 100) : 0;

  return {
    ...campaign,
    pendingCount: Math.max(0, pendingCount),
    deliveryRate: pct(campaign.deliveredCount),
    readRate: pct(campaign.readCount),
    replyRate: pct(campaign.repliedCount),
    failureReasons,
  };
}

/** Janela (dias) para atribuir uma resposta inbound a um disparo de campanha. */
const CAMPAIGN_REPLY_WINDOW_DAYS = 7;

/**
 * Correlaciona uma mensagem inbound de um contato ao disparo de campanha mais
 * recente (dentro da janela) e marca como respondido. Idempotente: só conta a
 * PRIMEIRA resposta por destinatário (filtro `repliedAt: null` + update
 * condicional). Multi-tenant: usa o `prisma` scoped do contexto atual.
 */
export async function markCampaignReplyByContact(
  contactId: string,
  repliedAt: Date = new Date(),
): Promise<void> {
  const windowStart = new Date(
    repliedAt.getTime() - CAMPAIGN_REPLY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const recipient = await prisma.campaignRecipient.findFirst({
    where: {
      contactId,
      repliedAt: null,
      status: { in: ["SENT", "DELIVERED", "READ"] },
      sentAt: { not: null, gte: windowStart },
    },
    orderBy: { sentAt: "desc" },
    select: { id: true, campaignId: true },
  });
  if (!recipient) return;

  // Update condicional (repliedAt ainda null) evita double-count em respostas
  // concorrentes para o mesmo destinatário.
  const updated = await prisma.campaignRecipient.updateMany({
    where: { id: recipient.id, repliedAt: null },
    data: { repliedAt },
  });
  if (updated.count === 0) return;

  await prisma.campaign.update({
    where: { id: recipient.campaignId },
    data: { repliedCount: { increment: 1 } },
  });
}

export type GetRecipientsParams = {
  campaignId: string;
  status?: string;
  page?: number;
  perPage?: number;
};

export async function getCampaignRecipients(params: GetRecipientsParams) {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(100, Math.max(1, params.perPage ?? 50));
  const skip = (page - 1) * perPage;

  const where: Prisma.CampaignRecipientWhereInput = {
    campaignId: params.campaignId,
  };
  if (params.status) where.status = params.status as never;

  const [items, total] = await Promise.all([
    prisma.campaignRecipient.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { createdAt: "desc" },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
      },
    }),
    prisma.campaignRecipient.count({ where }),
  ]);

  return { items, total, page, perPage, totalPages: Math.ceil(total / perPage) || 1 };
}

/**
 * Increment campaign counters atomically.
 */
export async function incrementCampaignCounter(
  campaignId: string,
  field: "sentCount" | "deliveredCount" | "failedCount" | "readCount",
  amount = 1,
) {
  return prisma.campaign.update({
    where: { id: campaignId },
    data: { [field]: { increment: amount } },
  });
}
