/**
 * Metadados opcionais do provedor telefônico em SipExtension.providerMeta.
 * Hoje: token Api4Com para discagem REST /dialer (webphone próprio).
 */
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";

export type Api4ComProviderMeta = {
  provider: "api4com";
  apiTokenEncrypted: string;
  accountEmailEncrypted?: string;
  accountPasswordEncrypted?: string;
};

export function buildApi4ComProviderMeta(
  apiToken: string,
  accountEmail: string,
  accountPassword: string,
): Api4ComProviderMeta {
  return {
    provider: "api4com",
    apiTokenEncrypted: encryptSecret(apiToken),
    accountEmailEncrypted: encryptSecret(accountEmail.trim()),
    accountPasswordEncrypted: encryptSecret(accountPassword),
  };
}

export function getApi4ComAccountFromProviderMeta(
  meta: unknown,
): { email: string; password: string } | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  if (m.provider !== "api4com") return null;
  if (
    typeof m.accountEmailEncrypted !== "string" ||
    typeof m.accountPasswordEncrypted !== "string"
  ) {
    return null;
  }
  try {
    return {
      email: decryptSecret(m.accountEmailEncrypted),
      password: decryptSecret(m.accountPasswordEncrypted),
    };
  } catch {
    return null;
  }
}

export function getApi4ComTokenFromProviderMeta(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  if (m.provider !== "api4com") return null;
  if (typeof m.apiTokenEncrypted !== "string" || !m.apiTokenEncrypted) return null;
  try {
    return decryptSecret(m.apiTokenEncrypted);
  } catch {
    return null;
  }
}

export function resolveDialProvider(
  wsServer: string,
  providerMeta: unknown,
): "api4com" | "sip" {
  if (wsServer.includes("api4com.com")) return "api4com";
  if (getApi4ComTokenFromProviderMeta(providerMeta)) return "api4com";
  return "sip";
}
