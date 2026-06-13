/**
 * Capacidade: recurrence (cobrança/entrega recorrente).
 *
 * Habilita `RecurrencePlan` (intervalo × valor). Serve para assinatura SaaS,
 * mensalidade, plano de manutenção — sem semântica vertical.
 */

import { z } from "zod";

import { defineCapability } from "../types";

export const recurrenceConfigSchema = z.object({
  interval: z
    .enum(["MONTHLY", "QUARTERLY", "YEARLY"])
    .default("MONTHLY")
    .meta({
      title: "Intervalo de recorrência",
      description: "Periodicidade do plano recorrente.",
    }),
  amount: z.number().min(0).default(0).meta({
    title: "Valor por ciclo",
    description: "Valor cobrado a cada intervalo.",
  }),
  trialDays: z.number().int().min(0).default(0).meta({
    title: "Período de teste (dias)",
    description: "Dias gratuitos antes da primeira cobrança. 0 = sem trial.",
  }),
});

export const recurrenceCapability = defineCapability({
  key: "recurrence",
  label: "Recorrência",
  description: "Planos recorrentes (intervalo × valor) para assinaturas e mensalidades.",
  configSchema: recurrenceConfigSchema,
});
