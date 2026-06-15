/**
 * Capacidade: shipping — entrega física.
 *
 * Discriminated union por `mode` (mantida mesmo com um modo só para
 * consistência com as demais capacidades e para extensão futura, ex.: digital).
 *
 *   - physical : tabela de frete por faixa de CEP (valor × prazo).
 *
 * Materializa em `ProductShipping` + `ShippingRange`.
 */

import { z } from "zod";

import { defineCapability } from "../types";

export const shippingPhysicalSchema = z.object({
  mode: z.literal("physical"),
  freeAbove: z.number().min(0).nullable().default(null).meta({
    title: "Frete grátis acima de",
    description: "Valor de pedido a partir do qual o frete é gratuito. Opcional.",
  }),
  defaultLeadDays: z.number().int().min(0).default(0).meta({
    title: "Prazo padrão (dias)",
    description: "Prazo de entrega padrão quando a faixa de CEP não define um.",
  }),
  originZip: z.string().trim().max(20).nullable().default(null).meta({
    title: "CEP de origem",
    description: "CEP de onde os itens são despachados. Opcional.",
  }),
});

// Futuro: shippingDigitalSchema (download, e-mail), shippingPickupSchema, etc.

export const shippingConfigSchema = z.discriminatedUnion("mode", [
  shippingPhysicalSchema,
]);

export const SHIPPING_MODES = ["physical"] as const;
export type ShippingMode = (typeof SHIPPING_MODES)[number];

export const shippingCapability = defineCapability({
  key: "shipping",
  label: "Frete",
  description:
    "Tabela de frete por faixa de CEP. Materializa em ProductShipping + ShippingRange.",
  configSchema: shippingConfigSchema,
});
