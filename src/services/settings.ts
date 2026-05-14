/**
 * `services/settings.ts` — helper para `system_settings` (chaves
 * **GLOBAIS** da plataforma EduIT).
 *
 * ⚠ Multi-tenancy v0:
 *
 *   `system_settings` NAO tem `organizationId`. Qualquer chave gravada
 *   aqui é vista por TODAS as orgs. Use SOMENTE para configs
 *   verdadeiramente cross-tenant (license keys EduIT, feature flags
 *   da plataforma, secrets compartilhados pelo time interno).
 *
 *   Para configs **per-cliente**, use `lib/org-settings.ts`:
 *
 *     import { getOrgSetting, setOrgSetting } from "@/lib/org-settings";
 *
 *   Lista de prefixos que JAMAIS devem entrar em system_settings (vetar
 *   no caller; o endpoint /api/settings/system tambem rejeita):
 *
 *     - `visibility.*`
 *     - `selfAssign.*`
 *     - `deals.*`
 *     - `ai.*`           (chave OpenAI por org — TODO no /api/settings/ai)
 *     - `onboarding.*`
 *     - `branding.*`
 *     - `loss_reason_required`
 */

import { prismaBase } from "@/lib/prisma-base";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";

const cache = new Map<string, { value: string; ts: number }>();
const CACHE_TTL = 60_000;

/**
 * Lista das chaves bloqueadas em runtime — qualquer get/set tentando uma
 * delas explode com erro detalhado pra evitar regressao.
 */
const ORG_SCOPED_KEY_PREFIXES = [
  "visibility.",
  "selfAssign.",
  "deals.",
  "onboarding.",
  "branding.",
];
const ORG_SCOPED_EXACT_KEYS = new Set(["loss_reason_required"]);

function assertGlobalKey(key: string): void {
  if (ORG_SCOPED_EXACT_KEYS.has(key)) {
    throw new Error(
      `[settings] Chave "${key}" e per-tenant. Use getOrgSetting/setOrgSetting (lib/org-settings).`,
    );
  }
  for (const prefix of ORG_SCOPED_KEY_PREFIXES) {
    if (key.startsWith(prefix)) {
      throw new Error(
        `[settings] Chaves "${prefix}*" sao per-tenant. Use getOrgSetting/setOrgSetting (lib/org-settings).`,
      );
    }
  }
}

export async function getSetting(key: string): Promise<string | null> {
  assertGlobalKey(key);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.value;

  const row = await prismaBase.systemSetting.findUnique({ where: { key } });
  if (row) {
    cache.set(key, { value: row.value, ts: Date.now() });
    return row.value;
  }
  return null;
}

export async function getSettingOrEnv(
  key: string,
  envName?: string,
): Promise<string> {
  const db = await getSetting(key);
  if (db) return db;
  return (envName ? process.env[envName]?.trim() : undefined) ?? "";
}

export async function setSetting(key: string, value: string): Promise<void> {
  assertGlobalKey(key);
  await prismaBase.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
  cache.set(key, { value, ts: Date.now() });
}

export async function deleteSetting(key: string): Promise<void> {
  assertGlobalKey(key);
  await prismaBase.systemSetting.deleteMany({ where: { key } });
  cache.delete(key);
}

export function invalidateSettingCache(key?: string): void {
  if (key) cache.delete(key);
  else cache.clear();
}

/**
 * Variante para segredos GLOBAIS — criptografa ao gravar e
 * descriptografa ao ler.
 *
 * NOTA: a chave OpenAI (`AI_OPENAI_KEY_SETTING = "ai.openai.api_key"`)
 * AINDA usa este caminho como compatibilidade. O TODO eh migrar para
 * `getOrgSecretSetting` em `/api/settings/ai`, permitindo cada tenant
 * configurar a propria chave. Hoje ela bate o assert.
 */
export async function getSecretSetting(key: string): Promise<string | null> {
  // Bypass do assert APENAS para a chave AI atual (compat).
  if (key === "ai.openai.api_key") {
    const row = await prismaBase.systemSetting.findUnique({ where: { key } });
    if (!row) return null;
    try {
      return decryptSecret(row.value);
    } catch {
      return null;
    }
  }
  const raw = await getSetting(key);
  if (!raw) return null;
  try {
    return decryptSecret(raw);
  } catch {
    return null;
  }
}

export async function getSecretSettingOrEnv(
  key: string,
  envName?: string,
): Promise<string> {
  const db = await getSecretSetting(key);
  if (db) return db;
  return (envName ? process.env[envName]?.trim() : undefined) ?? "";
}

export async function setSecretSetting(key: string, value: string): Promise<void> {
  if (key === "ai.openai.api_key") {
    await prismaBase.systemSetting.upsert({
      where: { key },
      update: { value: encryptSecret(value) },
      create: { key, value: encryptSecret(value) },
    });
    cache.set(key, { value: encryptSecret(value), ts: Date.now() });
    return;
  }
  await setSetting(key, encryptSecret(value));
}
