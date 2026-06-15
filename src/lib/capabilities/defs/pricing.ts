/**
 * Capacidade: pricing — modelos de cobrança.
 *
 * Discriminated union por `mode`. Adicionar um modo novo = adicionar uma
 * variante aqui + um componente de form no wizard. NUNCA quebra os pontos
 * de consumo: cada consumidor faz narrowing por `mode`.
 *
 * Materializa: `ProductOffer` (oferta por OrgUnit) — não é alterado.
 *
 * Os modos previstos pela arquitetura são (.cursorrules §1):
 *   one_time, recurring, per_unit, per_service, project, contract, commission
 *
 * Esta fase implementa os 3 mais usados (one_time, recurring, per_unit);
 * os demais aparecem como TODO — adicioná-los é trabalho local.
 */

import { z } from "zod";

import { defineCapability } from "../types";

const baseCommonFields = {
  currency: z.string().trim().length(3).default("BRL").meta({
    title: "Moeda",
    description: "Código ISO 4217 (ex.: BRL, USD).",
  }),
  allowPerUnitOverride: z.boolean().default(true).meta({
    title: "Permitir preço por unidade?",
    description: "Habilita ofertas com preço diferente por filial/CNPJ.",
  }),
};

/** Variante: cobrança única (default — equivalente ao schema pré-Fase 2). */
export const pricingOneTimeSchema = z.object({
  mode: z.literal("one_time"),
  basePrice: z.number().min(0).default(0).meta({
    title: "Preço base",
    description: "Preço padrão quando não há oferta específica por unidade.",
  }),
  ...baseCommonFields,
});

/** Variante: recorrente (assinatura SaaS, mensalidade, retainer). */
export const pricingRecurringSchema = z.object({
  mode: z.literal("recurring"),
  basePrice: z.number().min(0).default(0).meta({
    title: "Preço por ciclo",
    description: "Valor cobrado a cada intervalo.",
  }),
  interval: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]).default("MONTHLY").meta({
    title: "Intervalo",
    description: "Periodicidade da cobrança.",
  }),
  trialDays: z.number().int().min(0).default(0).meta({
    title: "Dias de trial",
    description: "Dias gratuitos antes da primeira cobrança.",
  }),
  ...baseCommonFields,
});

/** Variante: por unidade vendida (loja com SKU/quantidade variável). */
export const pricingPerUnitSchema = z.object({
  mode: z.literal("per_unit"),
  basePrice: z.number().min(0).default(0).meta({
    title: "Preço por unidade",
    description: "Valor cobrado por unidade vendida.",
  }),
  unitLabel: z.string().trim().min(1).default("un").meta({
    title: "Rótulo da unidade",
    description: "Como a unidade aparece para o cliente (ex.: un, kg, hora).",
  }),
  minQty: z.number().int().min(1).default(1).meta({
    title: "Quantidade mínima",
    description: "Quantidade mínima por pedido.",
  }),
  ...baseCommonFields,
});

// TODO Fase 4+: per_service, project, contract, commission. Cada um é uma
// variante nova no discriminatedUnion abaixo + um sub-form no wizard.
// Não toca em consumo.

export const pricingConfigSchema = z.discriminatedUnion("mode", [
  pricingOneTimeSchema,
  pricingRecurringSchema,
  pricingPerUnitSchema,
]);

/** Lista canônica de modos da capacidade pricing — usada pelo wizard. */
export const PRICING_MODES = ["one_time", "recurring", "per_unit"] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

export const pricingCapability = defineCapability({
  key: "pricing",
  label: "Precificação",
  description:
    "Como o produto é cobrado (cobrança única, recorrente, por unidade). Materializa em ProductOffer.",
  configSchema: pricingConfigSchema,
});
