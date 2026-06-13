/**
 * Capacidade: shipping (frete por faixa de CEP).
 *
 * Habilita `ShippingTable` + `ShippingRange` (faixa de CEP × valor × prazo).
 * Sem lógica vertical — qualquer produto físico pode ligar.
 */

import { z } from "zod";

import { defineCapability } from "../types";

export const shippingConfigSchema = z.object({
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

export const shippingCapability = defineCapability({
  key: "shipping",
  label: "Frete",
  description: "Tabela de frete por faixa de CEP (valor × prazo).",
  configSchema: shippingConfigSchema,
});
