/**
 * Capacidade: scheduling (agendamento / slots de capacidade).
 *
 * Habilita `CapacitySlot` (janela startsAt/endsAt, recurso opcional, pool 1-1
 * para controlar lotação). Sem lógica vertical — serve para turma, sessão,
 * consulta, evento, etc.
 */

import { z } from "zod";

import { defineCapability } from "../types";

export const schedulingConfigSchema = z.object({
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
});

export const schedulingCapability = defineCapability({
  key: "scheduling",
  label: "Agendamento",
  description:
    "Janelas de capacidade (slots) com horário, recurso opcional e lotação.",
  configSchema: schedulingConfigSchema,
});
