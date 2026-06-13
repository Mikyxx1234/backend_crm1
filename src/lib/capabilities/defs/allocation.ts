/**
 * Capacidade: allocation (alocação consumível via ledger).
 *
 * Habilita um `AllocationPool` (saldo = soma de `AllocationMovement.delta`,
 * nunca coluna mutável). `consumeTrigger` define QUANDO a baixa ocorre.
 * Decisão travada: MANUAL (padrão) | BY_AUTOMATION | ON_WON.
 */

import { z } from "zod";

import { defineCapability } from "../types";

export const allocationConfigSchema = z.object({
  consumeTrigger: z
    .enum(["MANUAL", "BY_AUTOMATION", "ON_WON"])
    .default("MANUAL")
    .meta({
      title: "Quando dar baixa no saldo?",
      description:
        "MANUAL: operador dá baixa. BY_AUTOMATION: um passo de automação. ON_WON: ao ganhar o negócio.",
    }),
  allowNegative: z.boolean().default(false).meta({
    title: "Permitir saldo negativo?",
    description: "Se desligado, o consumo é recusado quando não há saldo.",
  }),
  lowThreshold: z.number().int().min(0).nullable().default(null).meta({
    title: "Alerta de saldo baixo (opcional)",
    description: "Dispara um evento quando o saldo cai a este número.",
  }),
  initialBalance: z.number().int().min(0).default(0).meta({
    title: "Saldo inicial",
    description: "Quantidade inicial registrada como movimento de entrada.",
  }),
});

export const allocationCapability = defineCapability({
  key: "allocation",
  label: "Alocação consumível",
  description:
    "Controla um saldo consumível (estoque, vagas, assentos) via ledger auditável.",
  configSchema: allocationConfigSchema,
});
