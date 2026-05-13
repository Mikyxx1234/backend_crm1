import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";

const cache = new Map<string, { value: string; ts: number }>();
const CACHE_TTL = 60_000;

export async function getSetting(key: string): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.value;

  const row = await prisma.systemSetting.findUnique({ where: { key } });
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
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
  cache.set(key, { value, ts: Date.now() });
}

export async function deleteSetting(key: string): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key } });
  cache.delete(key);
}

export function invalidateSettingCache(key?: string): void {
  if (key) cache.delete(key);
  else cache.clear();
}

/**
 * Variante para segredos — criptografa ao gravar e descriptografa ao
 * ler. Em cima de `getSetting/setSetting`, garantindo que a forma
 * persistida em `system_settings.value` é sempre o ciphertext.
 */
export async function getSecretSetting(key: string): Promise<string | null> {
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
  await setSetting(key, encryptSecret(value));
}
