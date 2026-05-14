import { createHash, randomBytes } from "crypto";

// validateToken resolve orgId a partir do token ANTES de qualquer
// contexto existir — usa o client base. Dentro de routes autenticadas
// (listTokens/revokeToken) ja tem contexto, mas mantemos prismaBase pra
// consistencia e porque a extension exigiria contexto tambem nessas
// operacoes (o filtro por organizationId ja e feito explicitamente).
import { prismaBase as prisma } from "@/lib/prisma-base";
import { logAudit } from "@/lib/audit/log";

const TOKEN_PREFIX = "eduit_";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function generateToken(
  userId: string,
  organizationId: string,
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
      organizationId,
      expiresAt: expiresAt ?? null,
    },
    select: { id: true },
  });

  await logAudit({
    entity: "api_token",
    action: "token_create",
    entityId: record.id,
    organizationId,
    actorId: userId,
    after: {
      id: record.id,
      name: name.trim(),
      tokenPrefix,
      expiresAt: expiresAt ?? null,
    },
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
      organizationId: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          organizationId: true,
          isSuperAdmin: true,
          organization: { select: { status: true } },
        },
      },
    },
  });

  if (!record) return null;

  if (record.expiresAt && record.expiresAt < new Date()) return null;

  // Bloqueio se a organizacao do token nao estiver ATIVA. Super-admin
  // ignora o check — token dele nao depende de org.
  if (
    record.user.organization &&
    record.user.organization.status !== "ACTIVE" &&
    !record.user.isSuperAdmin
  ) {
    return null;
  }

  prisma.apiToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    tokenId: record.id,
    tokenHash,
    organizationId: record.organizationId,
    user: record.user,
  };
}

export async function listTokens(userId: string, organizationId: string) {
  return prisma.apiToken.findMany({
    where: { userId, organizationId },
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

export async function revokeToken(
  tokenId: string,
  userId: string,
  organizationId: string,
) {
  const existing = await prisma.apiToken.findFirst({
    where: { id: tokenId, userId, organizationId },
    select: { id: true, name: true, tokenPrefix: true, createdAt: true },
  });
  const result = await prisma.apiToken.deleteMany({
    where: { id: tokenId, userId, organizationId },
  });
  if (existing) {
    await logAudit({
      entity: "api_token",
      action: "token_revoke",
      entityId: tokenId,
      organizationId,
      actorId: userId,
      before: existing,
    });
  }
  return result;
}
