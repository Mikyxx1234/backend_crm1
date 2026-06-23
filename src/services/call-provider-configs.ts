/**
 * Service: CallProviderConfig — configuração de provedor de webhook por org.
 *
 * Cada registro mapeia um provedor (ex.: "generic-sip") a uma org, com:
 *  - webhookToken único (identifica a org no endpoint público)
 *  - webhookSecretEncrypted (HMAC secret ou token de auth — cifrado)
 *  - fieldMappings (config do adapter)
 */
import { randomBytes } from "node:crypto";
import type { RecordingDelivery, WebhookAuthMode } from "@prisma/client";

import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { withOrg } from "@/lib/prisma-helpers";
import { getOrgIdOrThrow } from "@/lib/request-context";
import { listProviders } from "./call-adapters";

// ── Tipos ─────────────────────────────────────────────────────────────────

export type CreateProviderConfigInput = {
  providerKey: string;
  fieldMappings?: Record<string, unknown>;
  authMode: WebhookAuthMode;
  /** Secret em plaintext — será cifrado antes de salvar. */
  webhookSecret: string;
  signatureHeader?: string | null;
  recordingDelivery?: RecordingDelivery;
  createContactsForCalls?: boolean;
  isActive?: boolean;
};

export type UpdateProviderConfigInput = {
  providerKey?: string;
  fieldMappings?: Record<string, unknown>;
  authMode?: WebhookAuthMode;
  /** Novo secret em texto puro — cifrado antes de persistir. */
  webhookSecret?: string;
  signatureHeader?: string | null;
  recordingDelivery?: RecordingDelivery;
  createContactsForCalls?: boolean;
  isActive?: boolean;
};

export type ProviderConfigPublic = {
  id: string;
  organizationId: string;
  providerKey: string;
  fieldMappings: unknown;
  authMode: WebhookAuthMode;
  /** Indica se o secret está configurado (nunca retorna o valor). */
  hasWebhookSecret: boolean;
  signatureHeader: string | null;
  webhookToken: string;
  recordingDelivery: RecordingDelivery;
  createContactsForCalls: boolean;
  isActive: boolean;
  /** URL pública do webhook para colar no painel do provedor. */
  webhookUrl: string;
  createdAt: Date;
  updatedAt: Date;
};

const SELECT_DB = {
  id: true,
  organizationId: true,
  providerKey: true,
  fieldMappings: true,
  authMode: true,
  webhookSecretEncrypted: true,
  signatureHeader: true,
  webhookToken: true,
  recordingDelivery: true,
  createContactsForCalls: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toPublic(
  row: {
    id: string;
    organizationId: string;
    providerKey: string;
    fieldMappings: unknown;
    authMode: WebhookAuthMode;
    webhookSecretEncrypted: string;
    signatureHeader: string | null;
    webhookToken: string;
    recordingDelivery: RecordingDelivery;
    createContactsForCalls: boolean;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
): ProviderConfigPublic {
  return {
    id: row.id,
    organizationId: row.organizationId,
    providerKey: row.providerKey,
    fieldMappings: row.fieldMappings,
    authMode: row.authMode,
    hasWebhookSecret: Boolean(row.webhookSecretEncrypted),
    signatureHeader: row.signatureHeader,
    webhookToken: row.webhookToken,
    recordingDelivery: row.recordingDelivery,
    createContactsForCalls: row.createContactsForCalls,
    isActive: row.isActive,
    webhookUrl: buildWebhookUrl(row.providerKey, row.webhookToken),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildWebhookUrl(providerKey: string, webhookToken: string): string {
  return `/api/webhooks/calls/${encodeURIComponent(providerKey)}?token=${webhookToken}`;
}

function generateWebhookToken(): string {
  return randomBytes(24).toString("hex");
}

// ── CRUD ──────────────────────────────────────────────────────────────────

/** Cria uma nova configuração de provedor para a org corrente. */
export async function createProviderConfig(
  input: CreateProviderConfigInput,
): Promise<ProviderConfigPublic> {
  const organizationId = getOrgIdOrThrow();

  const providers = listProviders();
  if (!providers.includes(input.providerKey)) {
    throw new Error(
      `Provedor desconhecido: "${input.providerKey}". Disponíveis: ${providers.join(", ")}`,
    );
  }

  const webhookToken = generateWebhookToken();
  const webhookSecretEncrypted = encryptSecret(input.webhookSecret);

  const row = await prisma.callProviderConfig.create({
    data: withOrg(
      {
        providerKey: input.providerKey,
        fieldMappings: input.fieldMappings ?? {},
        authMode: input.authMode,
        webhookSecretEncrypted,
        signatureHeader: input.signatureHeader ?? null,
        webhookToken,
        recordingDelivery: input.recordingDelivery ?? "URL",
        createContactsForCalls: input.createContactsForCalls ?? false,
        isActive: input.isActive ?? true,
      },
      organizationId,
    ),
    select: SELECT_DB,
  });

  return toPublic(row);
}

/** Lista todas as configs de provedor da org corrente. */
export async function listProviderConfigs(): Promise<ProviderConfigPublic[]> {
  const rows = await prisma.callProviderConfig.findMany({
    select: SELECT_DB,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toPublic);
}

/** Busca uma config pelo id (org-scoped via extension). */
export async function getProviderConfig(id: string): Promise<ProviderConfigPublic | null> {
  const row = await prisma.callProviderConfig.findUnique({ where: { id }, select: SELECT_DB });
  return row ? toPublic(row) : null;
}

/** Atualiza campos de uma config existente. */
export async function updateProviderConfig(
  id: string,
  input: UpdateProviderConfigInput,
): Promise<ProviderConfigPublic> {
  const updateData: Record<string, unknown> = {};

  if (input.fieldMappings !== undefined) updateData.fieldMappings = input.fieldMappings;
  if (input.authMode !== undefined) updateData.authMode = input.authMode;
  if (input.webhookSecret !== undefined)
    updateData.webhookSecretEncrypted = encryptSecret(input.webhookSecret);
  if (input.signatureHeader !== undefined) updateData.signatureHeader = input.signatureHeader;
  if (input.recordingDelivery !== undefined) updateData.recordingDelivery = input.recordingDelivery;
  if (input.createContactsForCalls !== undefined)
    updateData.createContactsForCalls = input.createContactsForCalls;

  const row = await prisma.callProviderConfig.update({
    where: { id },
    data: updateData,
    select: SELECT_DB,
  });

  return toPublic(row);
}

/** Remove uma config de provedor. */
export async function deleteProviderConfig(id: string): Promise<void> {
  await prisma.callProviderConfig.delete({ where: { id } });
}

/**
 * Busca uma config pelo webhookToken (SEM filtro de org).
 * Usado exclusivamente pelo endpoint de webhook público, que precisa
 * resolver a org a partir do token antes de ter qualquer contexto.
 *
 * Usa prismaBase (sem extension multi-tenant) porque o organizationId
 * ainda é desconhecido nesse ponto.
 */
export async function findConfigByWebhookToken(webhookToken: string): Promise<{
  id: string;
  organizationId: string;
  providerKey: string;
  fieldMappings: unknown;
  authMode: WebhookAuthMode;
  webhookSecretEncrypted: string;
  signatureHeader: string | null;
  webhookToken: string;
  recordingDelivery: RecordingDelivery;
  createContactsForCalls: boolean;
  isActive: boolean;
} | null> {
  return prismaBase.callProviderConfig.findUnique({
    where: { webhookToken },
    select: {
      id: true,
      organizationId: true,
      providerKey: true,
      fieldMappings: true,
      authMode: true,
      webhookSecretEncrypted: true,
      signatureHeader: true,
      webhookToken: true,
      recordingDelivery: true,
      createContactsForCalls: true,
      isActive: true,
    },
  });
}

/**
 * Descriptografa o webhookSecret de uma config.
 * NUNCA logar o retorno.
 */
export function decryptWebhookSecret(config: { webhookSecretEncrypted: string }): string {
  return decryptSecret(config.webhookSecretEncrypted);
}

/**
 * Busca ou cria a CallProviderConfig do tipo "api4com" para a org corrente.
 * Idempotente — pode ser chamado múltiplas vezes (cada operador que conecta
 * Api4com via UI cai aqui; só o primeiro cria, os demais reaproveitam).
 *
 * Modo TOKEN (Api4com não usa HMAC nos webhooks — autentica via token único
 * na URL `?token=<webhookToken>`). O webhookSecret aqui é o próprio token —
 * armazenamos cifrado por convenção do schema, mas a validação real no
 * `processWebhookEvent` é feita por `findConfigByWebhookToken`.
 */
export async function getOrCreateApi4ComProviderConfig(): Promise<ProviderConfigPublic> {
  const organizationId = getOrgIdOrThrow();

  const existing = await prisma.callProviderConfig.findFirst({
    where: { providerKey: "api4com" },
    select: SELECT_DB,
  });
  if (existing) return toPublic(existing);

  const webhookToken = generateWebhookToken();
  const webhookSecretEncrypted = encryptSecret(webhookToken);

  const row = await prisma.callProviderConfig.create({
    data: withOrg(
      {
        providerKey: "api4com",
        fieldMappings: {},
        authMode: "TOKEN" as WebhookAuthMode,
        webhookSecretEncrypted,
        signatureHeader: null,
        webhookToken,
        recordingDelivery: "URL" as RecordingDelivery,
        createContactsForCalls: false,
        isActive: true,
      },
      organizationId,
    ),
    select: SELECT_DB,
  });

  return toPublic(row);
}
