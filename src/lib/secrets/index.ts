import { createEnvProvider } from "./env-provider";
import type { SecretKey, SecretsProvider } from "./types";

/**
 * Public API do modulo de secrets.
 *
 * Uso recomendado:
 *
 *   import { secrets } from "@/lib/secrets";
 *   const dbUrl = secrets.required("DATABASE_URL");
 *   const optionalKey = secrets.optional("OPENAI_API_KEY");
 *
 * Migrar consumidores de `process.env.X` pra `secrets.required("X")`
 * tem o ganho de:
 *   1) auditoria centralizada (todas as deps de secret passam aqui);
 *   2) trocar provider por env (`SECRETS_PROVIDER=infisical`) sem
 *      mexer em call-sites;
 *   3) mensagens de erro padronizadas no missing-required.
 *
 * Em PR 3.3 NAO fizemos a migracao em massa — ainda existem ~XXX
 * consumidores chamando `process.env` direto. Eles continuam
 * funcionando, mas conforme tocarmos cada area portamos pra `secrets`.
 *
 * @see docs/secrets-management.md
 */

let provider: SecretsProvider | null = null;

function getProvider(): SecretsProvider {
  if (provider) return provider;
  const which = (process.env.SECRETS_PROVIDER ?? "env").trim().toLowerCase();
  switch (which) {
    case "env":
    case "":
      provider = createEnvProvider();
      break;
    case "infisical": {
      // Lazy import pra evitar custo quando nao usado.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("./infisical-provider");
      provider = mod.createInfisicalProvider();
      break;
    }
    case "doppler": {
      throw new Error(
        "SECRETS_PROVIDER=doppler ainda nao suportado. Adicione `src/lib/secrets/doppler-provider.ts` quando migrarmos.",
      );
    }
    default:
      throw new Error(
        `SECRETS_PROVIDER=${which} desconhecido. Use "env" ou "infisical".`,
      );
  }
  return provider!;
}

export const secrets = {
  /** Identificador do provider ativo (env|infisical|doppler). */
  get providerName(): string {
    return getProvider().name;
  },

  /** Retorna o secret ou `undefined`. */
  optional(key: SecretKey | string): string | undefined {
    return getProvider().get(key);
  },

  /**
   * Retorna o secret ou throw em missing.
   * Mensagem clara pra que dev/ops saibam onde plugar.
   */
  required(key: SecretKey | string): string {
    const v = getProvider().get(key);
    if (v === undefined || v.length === 0) {
      throw new Error(
        `Secret obrigatorio ausente: ${key}. Configure via .env ou no secrets manager (provider=${
          getProvider().name
        }).`,
      );
    }
    return v;
  },

  /** Pre-carrega secrets na memoria (chamado no boot). Idempotente. */
  async prefetch(keys?: ReadonlyArray<SecretKey | string>): Promise<void> {
    return getProvider().prefetch(keys);
  },

  /** Health check do provider. */
  async health(): Promise<{ ok: boolean; detail?: string }> {
    return getProvider().health();
  },

  /** Apenas para testes: troca o provider. */
  _setProviderForTests(p: SecretsProvider | null): void {
    provider = p;
  },
};

export type { SecretKey, SecretsProvider } from "./types";
