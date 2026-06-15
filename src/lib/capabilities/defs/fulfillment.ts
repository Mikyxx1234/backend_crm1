/**
 * Capacidade: fulfillment — o que acontece ao ganhar o deal.
 *
 * Discriminated union por `mode`. Os 5 modos cobrem os 5 casos canônicos
 * (ARQUITETURA §8) sem qualquer ramificação por "tipo de produto":
 *
 *   - delivery     : envio físico (loja). Aciona ProductShipping.
 *   - deliverables : entrega de artefatos (consultoria). Tarefa de configuração.
 *   - enrollment   : matrícula em curso (pós-venda em CourseConfig).
 *   - recruiting   : abre JobOpening com pipeline próprio (DealLink).
 *   - service      : agendamento de execução (barbearia, instalação).
 *
 * Materializa em `DealLink` + `JobOpening`/`CourseConfig` conforme o modo.
 * Os hooks reais ficam em `fulfillment.ts` (genérico) e `product-fulfillment.ts`
 * (verticais legados, em quarentena até Fase 6).
 */

import { z } from "zod";

import { defineCapability } from "../types";

const creationTriggerField = z
  .enum(["MANUAL", "BY_AUTOMATION", "ON_WON"])
  .default("MANUAL")
  .meta({
    title: "Quando criar a operação?",
    description:
      "MANUAL: cria tarefa de configuração. BY_AUTOMATION: via automação. ON_WON: cria automaticamente ao ganhar.",
  });

const operationalPipelineFields = {
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
};

export const fulfillmentDeliverySchema = z.object({
  mode: z.literal("delivery"),
  creationTrigger: creationTriggerField,
  ...operationalPipelineFields,
  trackingUrlTemplate: z.string().trim().max(500).default("").meta({
    title: "Template de URL de rastreio",
    description: "Aceita variáveis como {{trackingCode}}.",
  }),
});

export const fulfillmentDeliverablesSchema = z.object({
  mode: z.literal("deliverables"),
  creationTrigger: creationTriggerField,
  ...operationalPipelineFields,
  deliverableTemplateRef: z.string().trim().max(120).default("").meta({
    title: "Template de entregáveis",
    description: "Lista padrão de artefatos (ex.: 'design + 3 revisões').",
  }),
});

export const fulfillmentEnrollmentSchema = z.object({
  mode: z.literal("enrollment"),
  creationTrigger: creationTriggerField,
  ...operationalPipelineFields,
  postSalePipelineId: z.string().trim().min(1).nullable().default(null).meta({
    title: "Pipeline pós-venda do curso",
    description:
      "Funil que recebe o aluno após o ganho (CourseConfig.postSalePipelineId).",
  }),
});

export const fulfillmentRecruitingSchema = z.object({
  mode: z.literal("recruiting"),
  creationTrigger: creationTriggerField,
  ...operationalPipelineFields,
  candidatePipelineId: z.string().trim().min(1).nullable().default(null).meta({
    title: "Pipeline de candidatos",
    description: "Funil B2C onde candidatos da vaga progridem.",
  }),
});

export const fulfillmentServiceSchema = z.object({
  mode: z.literal("service"),
  creationTrigger: creationTriggerField,
  ...operationalPipelineFields,
  /** Quando true, cria automaticamente um CapacitySlot pendente ao ganhar. */
  createSlotOnWon: z.boolean().default(true).meta({
    title: "Criar slot ao ganhar?",
    description: "Reserva uma janela para execução do serviço.",
  }),
});

export const fulfillmentConfigSchema = z.discriminatedUnion("mode", [
  fulfillmentDeliverySchema,
  fulfillmentDeliverablesSchema,
  fulfillmentEnrollmentSchema,
  fulfillmentRecruitingSchema,
  fulfillmentServiceSchema,
]);

export const FULFILLMENT_MODES = [
  "delivery",
  "deliverables",
  "enrollment",
  "recruiting",
  "service",
] as const;
export type FulfillmentMode = (typeof FULFILLMENT_MODES)[number];

export const fulfillmentCapability = defineCapability({
  key: "fulfillment",
  label: "Operação pós-venda",
  description:
    "O que acontece ao ganhar o deal: envio, entregáveis, matrícula, vaga, ou serviço. Materializa em DealLink (+ JobOpening/CourseConfig).",
  configSchema: fulfillmentConfigSchema,
});
