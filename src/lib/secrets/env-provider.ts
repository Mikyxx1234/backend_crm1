import type { SecretsProvider } from "./types";

/**
 * Provider que le secrets diretamente de `process.env`.
 *
 * Default em todos os deploys hoje (PR 3.3). Zero overhead, zero I/O,
 * zero rede. Compatibilidade total com .env / EasyPanel / Docker
 * Swarm secrets injetados como env vars.
 */
export function createEnvProvider(): SecretsProvider {
  return {
    name: "env",

    get(key) {
      const v = process.env[key];
      if (v === undefined) return undefined;
      const trimmed = v.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    },

    async prefetch() {
      // No-op: process.env ja esta em memoria.
    },

    async health() {
      return { ok: true, detail: "env-backed (no remote check needed)" };
    },
  };
}
