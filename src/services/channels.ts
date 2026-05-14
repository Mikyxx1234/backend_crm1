import {
  Prisma,
  type Channel,
  type ChannelProvider,
  type ChannelStatus,
  type ChannelType,
} from "@prisma/client";

import {
  decryptChannelConfig,
  encryptChannelConfig,
} from "@/lib/channels/config";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { logAudit } from "@/lib/audit/log";
import { pickFields } from "@/lib/audit/redact";
import { cache } from "@/lib/cache";
import { channelKey } from "@/lib/cache/keys";

const CHANNEL_AUDIT_FIELDS = [
  "id",
  "name",
  "type",
  "provider",
  "phoneNumber",
  "status",
] as const;

export type CreateChannelData = {
  name: string;
  type: ChannelType;
  provider: ChannelProvider;
  config?: Prisma.InputJsonValue;
  phoneNumber?: string | null;
};

export type UpdateChannelData = {
  name?: string;
  type?: ChannelType;
  provider?: ChannelProvider;
  config?: Prisma.InputJsonValue;
  phoneNumber?: string | null;
  status?: ChannelStatus;
  qrCode?: string | null;
  sessionData?: Prisma.InputJsonValue | null;
  lastConnectedAt?: Date | null;
};

export type UpdateChannelStatusExtra = {
  qrCode?: string | null;
  lastConnectedAt?: Date | null;
  sessionData?: Prisma.InputJsonValue | null;
};

/**
 * Channel + slug da org dona — usado pela UI pra montar a URL do webhook
 * Meta scoped por organizacao (/api/webhooks/meta/{slug}). Sem o slug,
 * o painel de configuracao Meta nao conseguiria mostrar a URL correta
 * pro admin copiar/colar no painel da Meta.
 */
export type ChannelWithOrgSlug = Channel & { organizationSlug: string };

function attachOrgSlug<T extends Channel & { organization: { slug: string } | null }>(
  channel: T,
): ChannelWithOrgSlug {
  const { organization, ...rest } = channel;
  return { ...rest, organizationSlug: organization?.slug ?? "" };
}

export async function getChannels(): Promise<ChannelWithOrgSlug[]> {
  const channels = await prisma.channel.findMany({
    orderBy: { createdAt: "desc" },
    include: { organization: { select: { slug: true } } },
  });
  return channels.map(attachOrgSlug);
}

export async function getChannelById(
  id: string,
): Promise<ChannelWithOrgSlug | null> {
  const channel = await prisma.channel.findUnique({
    where: { id },
    include: { organization: { select: { slug: true } } },
  });
  return channel ? attachOrgSlug(channel) : null;
}

export async function createChannel(data: CreateChannelData): Promise<Channel> {
  // PR-1.2: encripta campos sensiveis (accessToken, appSecret, verifyToken)
  // antes de gravar. encryptChannelConfig e idempotente — se ja vier encriptado
  // (caso raro de re-uso de config), mantem como esta.
  const plainConfig = (data.config ?? {}) as Record<string, unknown>;
  const encryptedConfig = encryptChannelConfig(data.provider, plainConfig);

  const created = await prisma.channel.create({
    data: withOrgFromCtx({
      name: data.name.trim(),
      type: data.type,
      provider: data.provider,
      config: encryptedConfig as Prisma.InputJsonValue,
      phoneNumber: data.phoneNumber?.trim() || null,
    }),
  });
  await logAudit({
    entity: "channel",
    action: "create",
    entityId: created.id,
    after: pickFields(created, CHANNEL_AUDIT_FIELDS),
  });
  return created;
}

export async function updateChannel(id: string, data: UpdateChannelData): Promise<Channel> {
  const patch: Prisma.ChannelUpdateInput = {};
  if (data.name !== undefined) patch.name = data.name.trim();
  if (data.type !== undefined) patch.type = data.type;
  if (data.provider !== undefined) patch.provider = data.provider;
  if (data.config !== undefined) {
    // PR-1.2: encriptacao precisa do provider. Se nao vier no patch, busca
    // do registro existente. Mantemos uma unica round-trip a mais apenas
    // quando config muda — calls que so atualizam status/qr nao impactam.
    let provider: ChannelProvider | undefined = data.provider;
    if (!provider) {
      const existing = await prisma.channel.findUnique({
        where: { id },
        select: { provider: true },
      });
      provider = existing?.provider;
    }
    if (provider) {
      const plainConfig = (data.config ?? {}) as Record<string, unknown>;
      patch.config = encryptChannelConfig(
        provider,
        plainConfig,
      ) as Prisma.InputJsonValue;
    } else {
      // Fallback defensivo: sem provider (canal inexistente?), grava como veio.
      patch.config = data.config;
    }
  }
  if (data.phoneNumber !== undefined) patch.phoneNumber = data.phoneNumber?.trim() || null;
  if (data.status !== undefined) patch.status = data.status;
  if (data.qrCode !== undefined) patch.qrCode = data.qrCode;
  if (data.sessionData !== undefined) {
    patch.sessionData =
      data.sessionData === null ? Prisma.DbNull : data.sessionData;
  }
  if (data.lastConnectedAt !== undefined) patch.lastConnectedAt = data.lastConnectedAt;

  const before = await prisma.channel.findUnique({ where: { id } });
  const updated = await prisma.channel.update({
    where: { id },
    data: patch,
  });
  // Invalida lookups cacheados de webhook-context (PR 5.1). Cobre
  // todos os tipos de query (channelId, phoneNumber, metaPhoneNumberId,
  // baileysSessionId) — pattern delete e barato porque keys sao
  // poucas por canal.
  await cache.del(channelKey(id));
  await cache.delPattern("wh_ctx:*");
  // Sinaliza eventos de connect/disconnect alem de update generico —
  // util pra investigar interrupcoes de canal sem ler diff.
  let action: "update" | "channel_connect" | "channel_disconnect" = "update";
  if (before && before.status !== updated.status) {
    if (updated.status === "CONNECTED") action = "channel_connect";
    else if (
      before.status === "CONNECTED" &&
      (updated.status === "DISCONNECTED" || updated.status === "FAILED")
    ) {
      action = "channel_disconnect";
    }
  }
  await logAudit({
    entity: "channel",
    action,
    entityId: id,
    before: pickFields(before, CHANNEL_AUDIT_FIELDS),
    after: pickFields(updated, CHANNEL_AUDIT_FIELDS),
  });
  return updated;
}

export async function deleteChannel(id: string): Promise<Channel> {
  const existing = await prisma.channel.findUnique({ where: { id } });
  if (!existing) {
    throw new Error("Canal não encontrado.");
  }
  const deleted = await prisma.channel.delete({ where: { id } });
  await cache.del(channelKey(id));
  await cache.delPattern("wh_ctx:*");
  await logAudit({
    entity: "channel",
    action: "delete",
    entityId: id,
    before: pickFields(deleted, CHANNEL_AUDIT_FIELDS),
  });
  return deleted;
}

export async function updateChannelStatus(
  id: string,
  status: ChannelStatus,
  extra?: UpdateChannelStatusExtra
): Promise<Channel> {
  const data: Prisma.ChannelUpdateInput = { status };
  if (extra?.qrCode !== undefined) data.qrCode = extra.qrCode;
  if (extra?.lastConnectedAt !== undefined) data.lastConnectedAt = extra.lastConnectedAt;
  if (extra?.sessionData !== undefined) {
    data.sessionData =
      extra.sessionData === null ? Prisma.DbNull : extra.sessionData;
  }
  const updated = await prisma.channel.update({
    where: { id },
    data,
  });
  await cache.del(channelKey(id));
  return updated;
}

export function parseChannelConfig(config: unknown): Record<string, unknown> {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    return { ...(config as Record<string, unknown>) };
  }
  return {};
}

/**
 * Versao de `parseChannelConfig` que decripta os campos sensiveis usando
 * o provider do canal. Use SEMPRE que precisar usar accessToken/appSecret/
 * verifyToken (ex.: chamar Meta API, validar webhook signature).
 *
 * @see docs/secrets-encryption.md
 */
export function parseChannelConfigDecrypted(channel: {
  provider: ChannelProvider;
  config: unknown;
}): Record<string, unknown> {
  const parsed = parseChannelConfig(channel.config);
  return decryptChannelConfig(channel.provider, parsed);
}

export function appPublicBaseUrl(): string {
  const fromNext = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "";
  if (fromNext) return fromNext;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`;
  return "http://localhost:3000";
}

/** Limpa QR e sessão e define desconectado (uso após logout em APIs externas). */
export async function markChannelDisconnected(id: string): Promise<Channel> {
  const updated = await prisma.channel.update({
    where: { id },
    data: {
      status: "DISCONNECTED",
      qrCode: null,
      sessionData: Prisma.DbNull,
    },
  });
  await cache.del(channelKey(id));
  return updated;
}
