/**
 * ProvisioningService — máquina de estados que provisiona automaticamente
 * usuário + ramal + webhook na Api4com ao ligar o toggle "telephonyEnabled".
 *
 * Invariantes:
 *   - Cada passo concluído persiste provisioningStep ANTES de avançar.
 *   - 409 em POST /users = "já existe" → pula para CREATE_EXTENSION.
 *   - Toggle OFF: telephonyEnabled=false, status=INACTIVE. Não apaga histórico.
 *   - Retomada: ao chamar enableTelephony com step != IDLE, resume do ponto.
 *
 * Ver docs/PLAN-api4com.md §4 para diagrama de estados.
 */
import type { SipExtension, TelephonyProvisioningStep } from "@prisma/client";

import { encryptSecret } from "@/lib/crypto/secrets";
import { getLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { resolveApi4ComGateway } from "@/services/telephony-providers/api4com";

import { Api4ComClient, getApi4ComClient } from "./client";
import { Api4ComConflictError } from "./errors";
import type { Api4ComExtensionResponse } from "./types";

const log = getLogger("api4com-provisioning");

export type ProvisionResult = {
  success: boolean;
  step: TelephonyProvisioningStep;
  error?: string;
  sipExtensionId?: string;
};

export type ProvisionStatus = {
  telephonyEnabled: boolean;
  provisioningStep: TelephonyProvisioningStep;
  provisioningError: string | null;
  provisionedAt: Date | null;
};

type ProvisionContext = {
  userId: string;
  organizationId: string;
  client: Api4ComClient;
  ext: SipExtension;
};

/**
 * Ativa telefonia para o usuário: provisiona usuário, ramal e webhook na Api4com.
 * Idempotente — pode ser chamado múltiplas vezes com segurança.
 */
export async function enableTelephony(
  userId: string,
  organizationId: string,
): Promise<ProvisionResult> {
  const client = getApi4ComClient();
  const gateway = resolveApi4ComGateway(organizationId);
  const webhookVersion = process.env.API4COM_WEBHOOK_VERSION ?? "v1.4";

  let ext = await findOrCreateExtensionRecord(userId, organizationId);

  if (ext.provisioningStep === "ACTIVE") {
    log.info(`[prov] Usuário ${userId} já provisionado (ACTIVE). Noop.`);
    return { success: true, step: "ACTIVE", sipExtensionId: ext.id };
  }

  ext = await updateStep(ext.id, "CHECK_REMOTE");
  const ctx: ProvisionContext = { userId, organizationId, client, ext };

  try {
    const step = ext.provisioningStep as TelephonyProvisioningStep;
    await runFromStep(step, ctx, gateway, webhookVersion);

    ext = await prisma.sipExtension.update({
      where: { id: ext.id },
      data: {
        provisioningStep: "ACTIVE",
        provisioningError: null,
        provisionedAt: new Date(),
        telephonyEnabled: true,
        status: "ACTIVE",
      },
    });

    log.info(`[prov] Usuário ${userId} provisionado com sucesso.`);
    return { success: true, step: "ACTIVE", sipExtensionId: ext.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[prov] Falha no provisionamento de ${userId}: ${msg}`);
    await prisma.sipExtension.update({
      where: { id: ext.id },
      data: {
        provisioningStep: "FAILED",
        provisioningError: msg.slice(0, 2000),
      },
    });
    return { success: false, step: "FAILED", error: msg, sipExtensionId: ext.id };
  }
}

/**
 * Desativa telefonia (toggle OFF). Não exclui dados remotos nem histórico.
 */
export async function disableTelephony(
  userId: string,
  organizationId: string,
): Promise<void> {
  const ext = await prisma.sipExtension.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (!ext) return;

  await prisma.sipExtension.update({
    where: { id: ext.id },
    data: {
      telephonyEnabled: false,
      status: "INACTIVE",
      provisioningStep: "DISABLED",
    },
  });
  log.info(`[prov] Telefonia desativada para ${userId}.`);
}

/**
 * Consulta status de provisionamento.
 */
export async function getProvisioningStatus(
  userId: string,
  organizationId: string,
): Promise<ProvisionStatus | null> {
  const ext = await prisma.sipExtension.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: {
      telephonyEnabled: true,
      provisioningStep: true,
      provisioningError: true,
      provisionedAt: true,
    },
  });
  if (!ext) return null;
  return ext;
}

// ── Máquina de estados interna ──────────────────────────────────────────────

async function runFromStep(
  step: TelephonyProvisioningStep,
  ctx: ProvisionContext,
  gateway: string,
  webhookVersion: string,
): Promise<void> {
  const STEP_ORDER: TelephonyProvisioningStep[] = [
    "CHECK_REMOTE",
    "CREATE_USER",
    "CREATE_EXTENSION",
    "CONFIG_WEBHOOK",
  ];

  const startIdx = STEP_ORDER.indexOf(step);
  if (startIdx === -1) {
    throw new Error(`Step inválido para retomada: ${step}`);
  }

  let api4comUserId = ctx.ext.api4comUserId;

  for (let i = startIdx; i < STEP_ORDER.length; i++) {
    const current = STEP_ORDER[i];

    switch (current) {
      case "CHECK_REMOTE": {
        const user = await findUserOnCrm(ctx);
        if (user) {
          api4comUserId = user.id;
          await persistApi4comUserId(ctx.ext.id, api4comUserId);
        }
        await updateStep(ctx.ext.id, "CREATE_USER");
        break;
      }
      case "CREATE_USER": {
        if (!api4comUserId) {
          api4comUserId = await createRemoteUser(ctx);
          await persistApi4comUserId(ctx.ext.id, api4comUserId);
        }
        await updateStep(ctx.ext.id, "CREATE_EXTENSION");
        break;
      }
      case "CREATE_EXTENSION": {
        const extResp = await createRemoteExtension(ctx);
        await persistExtensionData(ctx.ext.id, extResp, gateway);
        await updateStep(ctx.ext.id, "CONFIG_WEBHOOK");
        break;
      }
      case "CONFIG_WEBHOOK": {
        await configureWebhook(ctx, gateway, webhookVersion);
        break;
      }
    }
  }
}

async function findUserOnCrm(ctx: ProvisionContext): Promise<{ id: string } | null> {
  const crmUser = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { email: true },
  });
  if (!crmUser?.email) return null;

  const remoteUsers = await ctx.client.findUsers({ email: crmUser.email });
  return remoteUsers.length > 0 ? { id: remoteUsers[0].id } : null;
}

async function createRemoteUser(ctx: ProvisionContext): Promise<string> {
  const crmUser = await prisma.user.findUniqueOrThrow({
    where: { id: ctx.userId },
    select: { email: true, name: true },
  });

  const password = generatePassword();

  try {
    const created = await ctx.client.createUser({
      name: crmUser.name ?? crmUser.email,
      email: crmUser.email,
      password,
      role: "USER",
    });
    return created.id;
  } catch (err) {
    if (err instanceof Api4ComConflictError) {
      log.warn(`[prov] Usuário ${crmUser.email} já existe na Api4com (409). Recuperando...`);
      const existing = await ctx.client.findUsers({ email: crmUser.email });
      if (existing.length > 0) return existing[0].id;
      throw new Error(
        `Conflito ao criar usuário (409), mas GET não retornou match para ${crmUser.email}.`,
      );
    }
    throw err;
  }
}

async function createRemoteExtension(
  ctx: ProvisionContext,
): Promise<Api4ComExtensionResponse> {
  return ctx.client.createNextExtension();
}

async function configureWebhook(
  ctx: ProvisionContext,
  gateway: string,
  webhookVersion: string,
): Promise<void> {
  const config = await prisma.callProviderConfig.findFirst({
    where: { organizationId: ctx.organizationId, providerKey: "api4com" },
    select: { webhookToken: true },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
  const webhookUrl = config
    ? `${baseUrl}/api/webhooks/calls/api4com?token=${config.webhookToken}`
    : `${baseUrl}/api/webhooks/calls/api4com`;

  await ctx.client.upsertIntegration({
    gateway,
    webhook: true,
    webhookConstraint: { metadata: { gateway } },
    metadata: {
      webhookUrl,
      webhookVersion,
      webhookTypes: ["channel-answer", "channel-hangup"],
    },
  });
}

// ── Helpers de persistência ─────────────────────────────────────────────────

async function findOrCreateExtensionRecord(
  userId: string,
  organizationId: string,
): Promise<SipExtension> {
  const existing = await prisma.sipExtension.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (existing) return existing;

  return prisma.sipExtension.create({
    data: {
      organizationId,
      userId,
      label: "Api4com (auto)",
      sipUri: "",
      authUser: "",
      authPasswordEncrypted: "",
      wsServer: "",
      stunServers: ["stun:stun.l.google.com:19302"],
      telephonyEnabled: true,
      provisioningStep: "IDLE",
    },
  });
}

async function updateStep(
  extId: string,
  step: TelephonyProvisioningStep,
): Promise<SipExtension> {
  return prisma.sipExtension.update({
    where: { id: extId },
    data: { provisioningStep: step },
  });
}

async function persistApi4comUserId(
  extId: string,
  api4comUserId: string,
): Promise<void> {
  await prisma.sipExtension.update({
    where: { id: extId },
    data: { api4comUserId },
  });
}

async function persistExtensionData(
  extId: string,
  resp: Api4ComExtensionResponse,
  gateway: string,
): Promise<void> {
  const domain = resp.domain;
  await prisma.sipExtension.update({
    where: { id: extId },
    data: {
      sipUri: `${resp.ramal}@${domain}`,
      authUser: resp.ramal,
      authPasswordEncrypted: encryptSecret(resp.senha),
      wsServer: `wss://${domain}:6443`,
      api4comGateway: gateway,
      providerMeta: {
        extensionId: resp.id,
        ramal: resp.ramal,
        domain,
        bina: resp.bina ?? null,
      },
    },
  });
}

function generatePassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%";
  let pw = "";
  for (let i = 0; i < 16; i++) {
    pw += chars[Math.floor(Math.random() * chars.length)];
  }
  return pw;
}
