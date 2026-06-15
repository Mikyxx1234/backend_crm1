/**
 * Capacidade: scheduling — janelas de capacidade (slots).
 *
 * Discriminated union por `mode`:
 *   - appointment : 1-on-1 (barbearia, consulta, serviço agendado).
 *   - classes     : turma com lotação (curso EAD/presencial — vincula CourseClass).
 *   - interview   : entrevista de candidato (vincula JobOpening).
 *
 * Materializa em `CapacitySlot` (e opcionalmente CourseClass). Sem semântica
 * vertical no consumo: o `mode` é só metadado para o wizard escolher o sub-form.
 */

import { z } from "zod";

import { defineCapability } from "../types";

const commonFields = {
  requiresResource: z.boolean().default(false).meta({
    title: "Exige recurso/sala?",
    description: "Vincula cada slot a um recurso (sala, instrutor, equipamento).",
  }),
  defaultDurationMinutes: z
    .number()
    .int()
    .min(0)
    .nullable()
    .default(null)
    .meta({
      title: "Duração padrão (min)",
      description: "Duração sugerida ao criar um slot. Opcional.",
    }),
  capacityPerSlot: z.number().int().min(1).nullable().default(null).meta({
    title: "Lotação por slot",
    description: "Quantidade de vagas por slot (vincula a um pool de alocação).",
  }),
};

export const schedulingAppointmentSchema = z.object({
  mode: z.literal("appointment"),
  ...commonFields,
});

export const schedulingClassesSchema = z.object({
  mode: z.literal("classes"),
  ...commonFields,
  /** Inicio sugerido das turmas (ex.: toda segunda 19h). Texto livre. */
  cadenceHint: z.string().trim().max(120).default("").meta({
    title: "Cadência sugerida",
    description: "Texto livre descrevendo quando novas turmas costumam abrir.",
  }),
});

export const schedulingInterviewSchema = z.object({
  mode: z.literal("interview"),
  ...commonFields,
  /** Estágios do funil B2C de candidatos que liberam reserva/consumo de slot. */
  bufferMinutesBetweenSlots: z.number().int().min(0).default(15).meta({
    title: "Intervalo entre entrevistas (min)",
    description: "Janela mínima entre slots para evitar atraso/sobreposição.",
  }),
});

export const schedulingConfigSchema = z.discriminatedUnion("mode", [
  schedulingAppointmentSchema,
  schedulingClassesSchema,
  schedulingInterviewSchema,
]);

export const SCHEDULING_MODES = ["appointment", "classes", "interview"] as const;
export type SchedulingMode = (typeof SCHEDULING_MODES)[number];

export const schedulingCapability = defineCapability({
  key: "scheduling",
  label: "Agendamento",
  description:
    "Janelas de capacidade (slots) com horário, recurso opcional e lotação. Materializa em CapacitySlot.",
  configSchema: schedulingConfigSchema,
});
