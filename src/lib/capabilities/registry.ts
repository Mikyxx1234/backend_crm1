/**
 * Registry central de capacidades — fonte única da verdade.
 *
 * Importado pelo backend (validação de config das junctions) e exposto ao
 * frontend via `GET /api/capabilities` (catálogo + JSON Schema para o wizard).
 *
 * Conjunto FECHADO: para adicionar uma capacidade, crie o arquivo em
 * `defs/<key>.ts`, registre aqui e adicione a chave em `CAPABILITY_KEYS`
 * (types.ts). Nenhuma outra parte do sistema deve precisar mudar.
 */

import { z } from "zod";

import { allocationCapability } from "./defs/allocation";
import { customDataCapability } from "./defs/custom_data";
import { fulfillmentCapability } from "./defs/fulfillment";
import { pricingCapability } from "./defs/pricing";
import { recurrenceCapability } from "./defs/recurrence";
import { schedulingCapability } from "./defs/scheduling";
import { shippingCapability } from "./defs/shipping";
import { stakeholdersCapability } from "./defs/stakeholders";
import {
  CAPABILITY_KEYS,
  type CapabilityDefinition,
  type CapabilityKey,
} from "./types";

/** Mapa chave → definição. Ordem alinhada a CAPABILITY_KEYS. */
export const CAPABILITY_REGISTRY: Record<CapabilityKey, CapabilityDefinition> = {
  allocation: allocationCapability,
  scheduling: schedulingCapability,
  recurrence: recurrenceCapability,
  shipping: shippingCapability,
  fulfillment: fulfillmentCapability,
  pricing: pricingCapability,
  stakeholders: stakeholdersCapability,
  custom_data: customDataCapability,
};

/** Type guard: a string é uma chave de capacidade conhecida? */
export function isCapabilityKey(value: unknown): value is CapabilityKey {
  return (
    typeof value === "string" &&
    (CAPABILITY_KEYS as readonly string[]).includes(value)
  );
}

/** Resolve a definição de uma capacidade (ou null se desconhecida). */
export function getCapability(
  key: string,
): CapabilityDefinition | null {
  return isCapabilityKey(key) ? CAPABILITY_REGISTRY[key] : null;
}

export class UnknownCapabilityError extends Error {
  constructor(public readonly key: string) {
    super(`Capacidade desconhecida: "${key}".`);
    this.name = "UnknownCapabilityError";
  }
}

export class CapabilityConfigError extends Error {
  constructor(
    public readonly key: string,
    public readonly error: z.ZodError,
  ) {
    super(`Config inválido para a capacidade "${key}".`);
    this.name = "CapabilityConfigError";
  }

  /** Forma achatada (mesmo padrão das rotas existentes: `error.flatten()`). */
  flatten() {
    return this.error.flatten();
  }
}

/**
 * Valida (e normaliza com defaults) o `config` de uma capacidade antes de
 * persistir na junction. Lança erro tipado tratável pela rota/serviço.
 *
 * Retorna o config PARSEADO (com defaults aplicados) — use o retorno ao
 * gravar, não o input cru.
 */
export function validateCapabilityConfig(
  key: string,
  config: unknown,
): Record<string, unknown> {
  const def = getCapability(key);
  if (!def) throw new UnknownCapabilityError(key);

  const result = def.configSchema.safeParse(config ?? {});
  if (!result.success) {
    throw new CapabilityConfigError(key, result.error);
  }
  return result.data as Record<string, unknown>;
}

/**
 * Catálogo serializável para o frontend. Cada entrada traz o JSON Schema do
 * config (Zod 4 nativo) para o wizard montar as sub-perguntas dinamicamente.
 */
/** JSON Schema serializado (forma estrutural, suficiente p/ o wizard). */
export type JsonSchemaObject = Record<string, unknown>;

export interface SerializedCapability {
  key: CapabilityKey;
  label: string;
  description: string;
  configSchema: JsonSchemaObject;
}

export function serializeCapabilities(): SerializedCapability[] {
  return CAPABILITY_KEYS.map((key) => {
    const def = CAPABILITY_REGISTRY[key];
    return {
      key,
      label: def.label,
      description: def.description,
      configSchema: z.toJSONSchema(def.configSchema) as JsonSchemaObject,
    };
  });
}
