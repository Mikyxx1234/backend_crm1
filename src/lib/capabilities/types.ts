/**
 * Tipos base do registro de capacidades (catálogo universal por capacidades).
 *
 * Fonte única da verdade do conjunto FECHADO de capacidades. O núcleo do
 * domínio conhece só `Product`/`Catalog`/`Capability` — verticais (curso,
 * vaga, SaaS, loja…) existem apenas como TEMPLATES de dados que LIGAM
 * capacidades. NUNCA adicione lógica vertical aqui: nada de `if (kind ===)`.
 *
 * Cada capacidade declara um schema Zod do seu `config` — usado em dois
 * lugares:
 *   1. Backend: valida a junction (`ProductCapability`/`CatalogCapability`)
 *      antes de persistir o `config Json`.
 *   2. Frontend: o schema é serializado (JSON Schema) e servido por
 *      `GET /api/capabilities`, permitindo ao wizard montar as sub-perguntas
 *      de cada capacidade SEM recodificar a tela quando uma capacidade nova
 *      é adicionada.
 */

import type { z } from "zod";

/** Conjunto fechado de chaves de capacidade. Adicionar aqui = adicionar capacidade. */
export const CAPABILITY_KEYS = [
  "allocation",
  "scheduling",
  "recurrence",
  "shipping",
  "fulfillment",
  "pricing",
  "stakeholders",
  "custom_data",
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

/**
 * Definição de uma capacidade. `configSchema` é um objeto Zod que valida o
 * `config` da junction. O tipo do config é inferido do próprio schema.
 */
export interface CapabilityDefinition<
  TSchema extends z.ZodType = z.ZodType,
> {
  /** Chave estável (snake_case) — usada em junctions, rotas e seeds. */
  key: CapabilityKey;
  /** Rótulo legível (pt-BR) exibido no wizard. */
  label: string;
  /** Descrição curta do que a capacidade habilita. */
  description: string;
  /** Schema Zod do `config` da junction. */
  configSchema: TSchema;
}

/** Config inferido do schema de uma definição de capacidade. */
export type CapabilityConfig<T extends CapabilityDefinition> =
  z.infer<T["configSchema"]>;

/**
 * Helper de declaração — preserva a inferência do schema Zod por capacidade.
 * Usar em cada arquivo de capacidade garante tipagem forte do `config`.
 */
export function defineCapability<TSchema extends z.ZodType>(
  def: CapabilityDefinition<TSchema>,
): CapabilityDefinition<TSchema> {
  return def;
}
