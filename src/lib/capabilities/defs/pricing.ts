/**
 * Capacidade: pricing (preço por unidade organizacional).
 *
 * Habilita `PriceOffer` (product × orgUnit × preço/desconto/condições).
 * Capacidade ligada por padrão a todo produto migrado do modelo legado
 * (backfill da Fase 1).
 */

import { z } from "zod";

import { defineCapability } from "../types";

export const pricingConfigSchema = z.object({
  basePrice: z.number().min(0).default(0).meta({
    title: "Preço base",
    description: "Preço padrão quando não há oferta específica por unidade.",
  }),
  currency: z.string().trim().length(3).default("BRL").meta({
    title: "Moeda",
    description: "Código ISO 4217 (ex.: BRL, USD).",
  }),
  allowPerUnitOverride: z.boolean().default(true).meta({
    title: "Permitir preço por unidade?",
    description: "Habilita ofertas com preço diferente por filial/CNPJ.",
  }),
});

export const pricingCapability = defineCapability({
  key: "pricing",
  label: "Precificação",
  description: "Preço base e ofertas por unidade organizacional (filial/CNPJ).",
  configSchema: pricingConfigSchema,
});
