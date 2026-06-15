/**
 * Capacidade: recurrence — repetição/renovação.
 *
 * Discriminated union por `mode`:
 *   - subscription : SaaS, mensalidade (renova automático).
 *   - retainer     : contrato consultivo de longa duração (renovação manual).
 *   - rebooking    : lembrete de recompra (serviço/barbearia).
 *
 * Materializa em `ProductPlan` (somente para `subscription`/`retainer`).
 * `rebooking` é puramente um trigger temporal (avaliado por `messaging`).
 */

import { z } from "zod";

import { defineCapability } from "../types";

const intervalEnum = z
  .enum(["MONTHLY", "QUARTERLY", "YEARLY"])
  .default("MONTHLY")
  .meta({ title: "Intervalo", description: "Periodicidade base." });

export const recurrenceSubscriptionSchema = z.object({
  mode: z.literal("subscription"),
  interval: intervalEnum,
  amount: z.number().min(0).default(0).meta({
    title: "Valor por ciclo",
    description: "Valor cobrado a cada intervalo.",
  }),
  trialDays: z.number().int().min(0).default(0).meta({
    title: "Período de teste (dias)",
    description: "Dias gratuitos antes da primeira cobrança.",
  }),
  autoRenew: z.boolean().default(true).meta({
    title: "Renovação automática?",
    description: "Se desligado, cliente precisa confirmar cada renovação.",
  }),
});

export const recurrenceRetainerSchema = z.object({
  mode: z.literal("retainer"),
  interval: intervalEnum,
  amount: z.number().min(0).default(0).meta({
    title: "Mensalidade fixa",
    description: "Valor fixo da retainer.",
  }),
  contractMonths: z.number().int().min(1).default(6).meta({
    title: "Duração do contrato (meses)",
    description: "Quantos ciclos compõem o contrato.",
  }),
});

export const recurrenceRebookingSchema = z.object({
  mode: z.literal("rebooking"),
  /** Quantos dias após o último ganho/uso dispara o nudge. */
  intervalDays: z.number().int().min(1).default(30).meta({
    title: "Intervalo de recompra (dias)",
    description: "Janela típica entre uma compra e a próxima sugerida.",
  }),
});

export const recurrenceConfigSchema = z.discriminatedUnion("mode", [
  recurrenceSubscriptionSchema,
  recurrenceRetainerSchema,
  recurrenceRebookingSchema,
]);

export const RECURRENCE_MODES = [
  "subscription",
  "retainer",
  "rebooking",
] as const;
export type RecurrenceMode = (typeof RECURRENCE_MODES)[number];

export const recurrenceCapability = defineCapability({
  key: "recurrence",
  label: "Recorrência",
  description:
    "Planos recorrentes (assinatura, retainer) e lembrete de recompra. Materializa em ProductPlan.",
  configSchema: recurrenceConfigSchema,
});
