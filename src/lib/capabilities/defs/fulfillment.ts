/**
 * Capacidade: fulfillment (operação pós-venda).
 *
 * Ao ganhar um deal COMMERCIAL com esta capacidade, conforme `creationTrigger`:
 *   - ON_WON: cria deal OPERATIONAL no pipeline configurado + DealLink(ORIGINATED).
 *   - BY_AUTOMATION: criado por passo de automação.
 *   - MANUAL (padrão): cria tarefa/notificação "configurar operação".
 *
 * Decisão travada: gatilho MANUAL é o padrão.
 */

import { z } from "zod";

import { defineCapability } from "../types";

export const fulfillmentConfigSchema = z.object({
  creationTrigger: z
    .enum(["MANUAL", "BY_AUTOMATION", "ON_WON"])
    .default("MANUAL")
    .meta({
      title: "Quando criar a operação?",
      description:
        "MANUAL: cria tarefa de configuração. BY_AUTOMATION: via automação. ON_WON: cria o deal operacional ao ganhar.",
    }),
  operationalPipelineId: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .default(null)
    .meta({
      title: "Pipeline da operação",
      description: "Funil onde o deal operacional é criado. Necessário p/ ON_WON.",
    }),
  operationalStageId: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .default(null)
    .meta({
      title: "Estágio inicial da operação",
      description: "Estágio de entrada do deal operacional. Opcional.",
    }),
});

export const fulfillmentCapability = defineCapability({
  key: "fulfillment",
  label: "Operação pós-venda",
  description:
    "Cria a operação (deal operacional) ao ganhar a venda, ligada por DealLink.",
  configSchema: fulfillmentConfigSchema,
});
