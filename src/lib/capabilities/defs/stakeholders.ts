/**
 * Capacidade: stakeholders (partes interessadas + regras de notificação).
 *
 * Habilita `Stakeholder` (contactId × role × channel) e `StakeholderRule`
 * (event × role × templateRef). As regras são avaliadas por
 * `stakeholder-notify` em eventos de domínio — sem lógica vertical.
 */

import { z } from "zod";

import { defineCapability } from "../types";

export const stakeholdersConfigSchema = z.object({
  defaultChannel: z
    .enum(["WHATSAPP", "EMAIL"])
    .default("WHATSAPP")
    .meta({
      title: "Canal padrão de notificação",
      description: "Canal usado quando a regra não especifica um.",
    }),
  notifyOnEvents: z
    .array(
      z.enum([
        "STAGE_ENTERED",
        "DEAL_WON",
        "DEAL_LOST",
        "ALLOCATION_CONSUMED",
      ]),
    )
    .default([])
    .meta({
      title: "Eventos que disparam notificação",
      description: "Quais eventos de domínio avaliam as regras de stakeholder.",
    }),
});

export const stakeholdersCapability = defineCapability({
  key: "stakeholders",
  label: "Partes interessadas",
  description:
    "Contatos por papel + regras de notificação por evento (template/Flow).",
  configSchema: stakeholdersConfigSchema,
});
