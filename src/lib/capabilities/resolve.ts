/**
 * Resolução de config efetiva — cascata catálogo → produto → unidade.
 *
 * Regra (ARQUITETURA §4.3 / MAPEAMENTO §3):
 *   config efetiva = merge(
 *     CatalogCapability.config,                        // base
 *     ProductCapability.config,                        // override produto (se policy permitir)
 *     ProductCapability.unitOverrides[orgUnitId]       // override por unidade
 *   )
 *
 * Princípios:
 *   - Um lugar só (não espalhar lógica de cascata por services).
 *   - Sempre revalida o resultado pelo Zod do `mode` final, com defaults aplicados.
 *   - Se a policy do catálogo é LOCKED, o config do produto é IGNORADO
 *     silenciosamente nesta resolução (a rejeição dura acontece em
 *     `assertOverrideAllowed`, antes de persistir).
 *   - `mode` é resolvido pela mesma cascata; em LOCKED, o do catálogo vence.
 */

import { validateCapabilityConfig } from "./registry";

type Json = Record<string, unknown>;

export interface CatalogCapabilityRow {
  capabilityKey: string;
  mode: string;
  config: Json | null;
  overridePolicy: "LOCKED" | "DEFAULT" | "OPEN";
  enabled: boolean;
}

export interface ProductCapabilityRow {
  capabilityKey: string;
  mode: string;
  config: Json | null;
  unitOverrides: Record<string, Json> | null;
  enabled: boolean;
}

export interface ResolvedCapability {
  capabilityKey: string;
  /** Modo final aplicado (após cascata + policy). */
  mode: string;
  /** Config final, já parseada/normalizada pelo Zod do `mode`. */
  config: Json;
  /** Origem efetiva (debug-friendly). */
  source: {
    fromCatalog: boolean;
    overriddenByProduct: boolean;
    overriddenByUnit: boolean;
    policyApplied: "LOCKED" | "DEFAULT" | "OPEN" | "NO_CATALOG";
  };
  enabled: boolean;
}

function shallowMerge(...layers: Array<Json | null | undefined>): Json {
  const acc: Json = {};
  for (const layer of layers) {
    if (!layer || typeof layer !== "object") continue;
    for (const [k, v] of Object.entries(layer)) {
      if (v !== undefined) acc[k] = v;
    }
  }
  return acc;
}

/**
 * Resolve a config efetiva de uma capacidade para um (produto, unidade?).
 *
 * Aceita as duas pontas (catálogo + produto) como opcionais para cobrir os
 * casos: só catálogo (produto não overrides), só produto (capacidade
 * ligada apenas no produto), ambos, ou nenhum (retorna null).
 */
export function resolveCapabilityConfig(args: {
  catalogCap: CatalogCapabilityRow | null;
  productCap: ProductCapabilityRow | null;
  orgUnitId?: string | null;
}): ResolvedCapability | null {
  const { catalogCap, productCap, orgUnitId } = args;

  if (!catalogCap && !productCap) return null;
  if (catalogCap && !catalogCap.enabled && !productCap?.enabled) return null;

  const key = (catalogCap?.capabilityKey ?? productCap?.capabilityKey)!;
  const policy = catalogCap?.overridePolicy ?? "NO_CATALOG";

  // Modo efetivo: catálogo manda em LOCKED; senão produto vence quando presente.
  const mode =
    policy === "LOCKED"
      ? catalogCap!.mode
      : productCap?.mode ?? catalogCap?.mode ?? "default";

  const catalogConfig = catalogCap?.config ?? {};
  const productConfig =
    policy === "LOCKED" ? {} : productCap?.config ?? {};
  const unitConfig =
    policy === "LOCKED"
      ? {}
      : orgUnitId && productCap?.unitOverrides?.[orgUnitId]
        ? productCap.unitOverrides[orgUnitId]
        : {};

  // Merge dos 3 layers + injeção do `mode` final.
  const merged = shallowMerge(catalogConfig, productConfig, unitConfig, {
    mode,
  });

  // Revalidação pelo Zod do `mode` final (aplica defaults).
  const parsed = validateCapabilityConfig(key, merged);

  return {
    capabilityKey: key,
    mode,
    config: parsed,
    source: {
      fromCatalog: !!catalogCap,
      overriddenByProduct:
        policy !== "LOCKED" &&
        !!productCap &&
        Object.keys(productCap.config ?? {}).length > 0,
      overriddenByUnit:
        policy !== "LOCKED" &&
        !!orgUnitId &&
        !!productCap?.unitOverrides?.[orgUnitId],
      policyApplied: policy,
    },
    enabled: (productCap?.enabled ?? catalogCap?.enabled ?? false) === true,
  };
}
