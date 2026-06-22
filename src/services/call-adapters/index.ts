/**
 * Registry de adapters de provedor SIP.
 *
 * Para adicionar um novo provedor:
 *  1. Crie `services/call-adapters/<provider>.ts` implementando `CallAdapter`.
 *  2. Registre a chave aqui com o mesmo valor que será usado em
 *     `CallProviderConfig.providerKey`.
 *
 * O registry é intencionalmente simples (Record) — sem DI, sem factory,
 * sem magic. Um objeto literal é suficiente e fácil de testar.
 */
import type { CallAdapter } from "./types";
import { api4comAdapter } from "./api4com";
import { genericSipAdapter } from "./generic-sip";

export type { CallAdapter, NormalizedCallEvent } from "./types";

// ── Registry ──────────────────────────────────────────────────────────────

const ADAPTERS: Record<string, CallAdapter> = {
  "generic-sip": genericSipAdapter,
  api4com: api4comAdapter,
  // Futuros provedores: "asterisk", "twilio", "vonage", ...
};

/**
 * Retorna o adapter para a chave de provedor informada.
 * @throws Error com mensagem clara se a chave for desconhecida.
 */
export function getAdapter(providerKey: string): CallAdapter {
  const adapter = ADAPTERS[providerKey];
  if (!adapter) {
    const available = Object.keys(ADAPTERS).join(", ");
    throw new Error(
      `[call-adapters] Provedor desconhecido: "${providerKey}". Disponíveis: [${available}]`,
    );
  }
  return adapter;
}

/** Lista de provedores disponíveis (para validação de UI e API). */
export function listProviders(): string[] {
  return Object.keys(ADAPTERS);
}
