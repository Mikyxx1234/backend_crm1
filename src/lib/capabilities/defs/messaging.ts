/**
 * Capacidade: messaging — comunicação dirigida por evento (transversal).
 *
 * Discriminated union por `mode`:
 *   - event_driven : regras síncronas (Fase 5a). `on` é um evento que já existe
 *                    em `deals.ts`/`stakeholder-notify.ts` (STAGE_ENTERED, DEAL_WON,
 *                    DEAL_LOST, ALLOCATION_CONSUMED, ou eventos de funil
 *                    candidato/recruiting).
 *   - temporal     : regras assíncronas (Fase 5b). Disparadas por worker
 *                    periódico em offsets relativos a um `anchor`
 *                    (schedule.upcoming_24h, service.completed_30d, etc.).
 *                    Requer migration aditiva em StakeholderRule
 *                    (delayMs/anchor) — ver PLANO.md Fase 4.9.
 *
 * PRINCÍPIO (MAPEAMENTO.md §7): a config aqui é **vista declarativa** —
 * a fonte da verdade das regras é a tabela `stakeholder_rules` (model
 * `StakeholderRule`). O wizard sincroniza a lista nas duas direções.
 * Não duplicar storage; este JSON serve para defaults + payload do wizard.
 *
 * `messaging.to` SEMPRE referencia um papel definido na capacidade
 * `stakeholders` do mesmo produto (.cursorrules §1).
 */

import { z } from "zod";

import { defineCapability } from "../types";

const channelEnum = z
  .enum(["WHATSAPP", "EMAIL"])
  .default("WHATSAPP")
  .meta({ title: "Canal", description: "Canal de entrega da mensagem." });

const baseRuleFields = {
  /** Papel do destinatário, casando com ProductStakeholder.role. */
  to: z.string().trim().min(1).meta({
    title: "Destinatário (papel)",
    description: "Papel da capacidade stakeholders (ex.: customer, lead, student).",
  }),
  /** Referência ao template/Flow (resolvido em runtime). */
  template: z.string().trim().min(1).meta({
    title: "Template/Flow",
    description: "Nome do template WhatsApp ou ID do Flow.",
  }),
  channel: channelEnum,
  enabled: z.boolean().default(true),
};

/** Regra síncrona (Fase 5a). */
export const messagingEventRuleSchema = z.object({
  /** Evento de domínio que dispara — alinhado a StakeholderRule.event. */
  on: z
    .enum([
      "STAGE_ENTERED",
      "DEAL_WON",
      "DEAL_LOST",
      "ALLOCATION_CONSUMED",
      "CANDIDATE_SENT_TO_CLIENT",
    ])
    .meta({ title: "Evento" }),
  ...baseRuleFields,
});

/** Regra temporal (Fase 5b). */
export const messagingTemporalRuleSchema = z.object({
  /** Âncora temporal — define A QUAL evento o delay é relativo. */
  anchor: z
    .enum([
      "SCHEDULE_UPCOMING",
      "SERVICE_COMPLETED",
      "DEAL_WON",
      "SHIPPING_STATUS_CHANGED",
    ])
    .meta({ title: "Âncora temporal" }),
  /** Offset em ms (positivo = depois da âncora; negativo = antes). */
  offsetMs: z.number().int().meta({
    title: "Offset (ms)",
    description: "Positivo = depois; negativo = antes. Ex.: -86400000 = 24h antes.",
  }),
  ...baseRuleFields,
});

export const messagingEventDrivenSchema = z.object({
  mode: z.literal("event_driven"),
  defaultChannel: channelEnum,
  rules: z.array(messagingEventRuleSchema).default([]).meta({
    title: "Regras síncronas",
    description: "Regras avaliadas no momento exato do evento.",
  }),
});

export const messagingTemporalSchema = z.object({
  mode: z.literal("temporal"),
  defaultChannel: channelEnum,
  rules: z.array(messagingTemporalRuleSchema).default([]).meta({
    title: "Regras temporais",
    description: "Regras disparadas por worker em offsets relativos à âncora.",
  }),
});

export const messagingConfigSchema = z.discriminatedUnion("mode", [
  messagingEventDrivenSchema,
  messagingTemporalSchema,
]);

export const MESSAGING_MODES = ["event_driven", "temporal"] as const;
export type MessagingMode = (typeof MESSAGING_MODES)[number];

export const messagingCapability = defineCapability({
  key: "messaging",
  label: "Mensageria por evento",
  description:
    "Regras evento→template→destinatário (síncronas ou temporais). Vista sobre StakeholderRule.",
  configSchema: messagingConfigSchema,
});
