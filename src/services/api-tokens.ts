import { createHash, randomBytes } from "crypto";

import { prisma } from "@/lib/prisma";

const TOKEN_PREFIX = "eduit_";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function generateToken(
  userId: string,
  name: string,
  expiresAt?: Date | null
): Promise<{ id: string; token: string; prefix: string }> {
  const raw = TOKEN_PREFIX + randomBytes(24).toString("hex");
  const tokenHash = hashToken(raw);
  const tokenPrefix = raw.slice(0, 12);

  const record = await prisma.apiToken.create({
    data: {
      name: name.trim(),
      tokenHash,
      tokenPrefix,
      userId,
      expiresAt: expiresAt ?? null,
    },
    select: { id: true },
  });

  return { id: record.id, token: raw, prefix: tokenPrefix };
}

export async function validateToken(rawToken: string) {
  const tokenHash = hashToken(rawToken);

  const record = await prisma.apiToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      user: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  if (!record) return null;

  if (record.expiresAt && record.expiresAt < new Date()) return null;

  prisma.apiToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    tokenId: record.id,
    tokenHash,
    user: record.user,
  };
}

export async function listTokens(userId: string) {
  return prisma.apiToken.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeToken(tokenId: string, userId: string) {
  return prisma.apiToken.deleteMany({
    where: { id: tokenId, userId },
  });
}
