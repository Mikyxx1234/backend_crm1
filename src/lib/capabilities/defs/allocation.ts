/**
 * Capacidade: allocation — saldo consumível via ledger.
 *
 * No documento de arquitetura esta capacidade é chamada "inventory" — em
 * código (CAPABILITY_KEYS) o nome é `allocation` (ver `.cursorrules` e
 * MAPEAMENTO.md §1). Materializa em `InventoryPool` + `InventoryMovement`
 * (nomes mantidos no schema por compat).
 *
 * Discriminated union por `mode`:
 *   - units : SKU físico ou digital (loja, e-commerce).
 *   - seats : vagas/lugares (curso com cota, vaga de emprego — JobOpening).
 *   - quota : cota por OrgUnit (cursos com unidades, franquias).
 *
 * Campos compartilhados (gatilho, saldo negativo, alerta, saldo inicial)
 * vivem em todas as variantes — a variante apenas troca o RÓTULO/semântica.
 */

import { z } from "zod";

import { defineCapability } from "../types";

const consumeTriggerField = z
  .enum(["MANUAL", "BY_AUTOMATION", "ON_WON"])
  .default("MANUAL")
  .meta({
    title: "Quando dar baixa no saldo?",
    description:
      "MANUAL: operador dá baixa. BY_AUTOMATION: passo de automação. ON_WON: ao ganhar o negócio.",
  });

const allowNegativeField = z.boolean().default(false).meta({
  title: "Permitir saldo negativo?",
  description: "Se desligado, o consumo é recusado quando não há saldo.",
});

const lowThresholdField = z.number().int().min(0).nullable().default(null).meta({
  title: "Alerta de saldo baixo",
  description: "Dispara um evento quando o saldo cai a este número. Opcional.",
});

/** Variante: units (default — equivale ao schema pré-Fase 2). */
export const allocationUnitsSchema = z.object({
  mode: z.literal("units"),
  consumeTrigger: consumeTriggerField,
  allowNegative: allowNegativeField,
  lowThreshold: lowThresholdField,
  initialBalance: z.number().int().min(0).default(0).meta({
    title: "Saldo inicial",
    description: "Quantidade inicial registrada como entrada no ledger.",
  }),
});

/** Variante: seats (vagas, lugares — JobOpening / cursos). */
export const allocationSeatsSchema = z.object({
  mode: z.literal("seats"),
  consumeTrigger: consumeTriggerField,
  allowNegative: allowNegativeField,
  lowThreshold: lowThresholdField,
  totalSeats: z.number().int().min(0).default(0).meta({
    title: "Total de vagas",
    description: "Quantidade total de vagas/lugares disponíveis.",
  }),
});

/** Variante: quota (cota por OrgUnit — útil com unitOverrides). */
export const allocationQuotaSchema = z.object({
  mode: z.literal("quota"),
  consumeTrigger: consumeTriggerField,
  allowNegative: allowNegativeField,
  lowThreshold: lowThresholdField,
  /**
   * Cota base por OrgUnit. `unitOverrides` em `ProductCapability` (Fase 1)
   * sobrescreve este valor por filial.
   */
  defaultQuotaPerUnit: z.number().int().min(0).default(0).meta({
    title: "Cota padrão por unidade",
    description:
      "Cota base aplicada a cada OrgUnit. Sobrescrevível via unitOverrides.",
  }),
});

export const allocationConfigSchema = z.discriminatedUnion("mode", [
  allocationUnitsSchema,
  allocationSeatsSchema,
  allocationQuotaSchema,
]);

export const ALLOCATION_MODES = ["units", "seats", "quota"] as const;
export type AllocationMode = (typeof ALLOCATION_MODES)[number];

export const allocationCapability = defineCapability({
  key: "allocation",
  label: "Alocação consumível",
  description:
    "Saldo consumível (estoque, vagas, cota) via ledger auditável. Materializa em InventoryPool + InventoryMovement.",
  configSchema: allocationConfigSchema,
});
