import {
  Prisma,
  type Channel,
  type ChannelProvider,
  type ChannelStatus,
  type ChannelType,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

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

export async function getChannels(): Promise<Channel[]> {
  return prisma.channel.findMany({
    orderBy: { createdAt: "desc" },
  });
}

export async function getChannelById(id: string): Promise<Channel | null> {
  return prisma.channel.findUnique({ where: { id } });
}

export async function createChannel(data: CreateChannelData): Promise<Channel> {
  return prisma.channel.create({
    data: {
      name: data.name.trim(),
      type: data.type,
      provider: data.provider,
      config: data.config ?? {},
      phoneNumber: data.phoneNumber?.trim() || null,
    },
  });
}

export async function updateChannel(id: string, data: UpdateChannelData): Promise<Channel> {
  const patch: Prisma.ChannelUpdateInput = {};
  if (data.name !== undefined) patch.name = data.name.trim();
  if (data.type !== undefined) patch.type = data.type;
  if (data.provider !== undefined) patch.provider = data.provider;
  if (data.config !== undefined) patch.config = data.config;
  if (data.phoneNumber !== undefined) patch.phoneNumber = data.phoneNumber?.trim() || null;
  if (data.status !== undefined) patch.status = data.status;
  if (data.qrCode !== undefined) patch.qrCode = data.qrCode;
  if (data.sessionData !== undefined) {
    patch.sessionData =
      data.sessionData === null ? Prisma.DbNull : data.sessionData;
  }
  if (data.lastConnectedAt !== undefined) patch.lastConnectedAt = data.lastConnectedAt;

  return prisma.channel.update({
    where: { id },
    data: patch,
  });
}

export async function deleteChannel(id: string): Promise<Channel> {
  const existing = await prisma.channel.findUnique({ where: { id } });
  if (!existing) {
    throw new Error("Canal não encontrado.");
  }
  return prisma.channel.delete({ where: { id } });
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
  return prisma.channel.update({
    where: { id },
    data,
  });
}

export function parseChannelConfig(config: unknown): Record<string, unknown> {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    return { ...(config as Record<string, unknown>) };
  }
  return {};
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
  return prisma.channel.update({
    where: { id },
    data: {
      status: "DISCONNECTED",
      qrCode: null,
      sessionData: Prisma.DbNull,
    },
  });
}
