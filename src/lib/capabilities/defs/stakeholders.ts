/**
 * Capacidade: stakeholders — papéis envolvidos no produto e canal padrão.
 *
 * Discriminated union por `mode`. O `mode` aqui é um "preset" de papel
 * primário — não muda a estrutura, mas o wizard usa para sugerir defaults
 * (qual `role` aparece como sugestão em ProductStakeholder, qual lista de
 * eventos faz sentido).
 *
 *   - customer        : comprador final (loja, SaaS).
 *   - lead            : prospect ainda em pré-venda.
 *   - company_contacts: múltiplos contatos da empresa cliente (consultoria, B2B).
 *   - student         : aluno (curso).
 *   - client          : empresa contratante (recrutamento).
 *
 * Materializa em `ProductStakeholder` (contatos por papel) e `StakeholderRule`
 * (regras de notificação — base da capacidade `messaging`).
 */

import { z } from "zod";

import { defineCapability } from "../types";

const commonFields = {
  defaultChannel: z.enum(["WHATSAPP", "EMAIL"]).default("WHATSAPP").meta({
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
};

export const stakeholdersCustomerSchema = z.object({
  mode: z.literal("customer"),
  ...commonFields,
});

export const stakeholdersLeadSchema = z.object({
  mode: z.literal("lead"),
  ...commonFields,
});

export const stakeholdersCompanyContactsSchema = z.object({
  mode: z.literal("company_contacts"),
  ...commonFields,
  /** Quantidade típica de contatos por cliente (sugestão do wizard). */
  expectedContactsPerAccount: z.number().int().min(1).default(3).meta({
    title: "Contatos esperados por conta",
    description: "Sugestão usada pelo wizard ao oferecer slots de papel.",
  }),
});

export const stakeholdersStudentSchema = z.object({
  mode: z.literal("student"),
  ...commonFields,
});

export const stakeholdersClientSchema = z.object({
  mode: z.literal("client"),
  ...commonFields,
});

export const stakeholdersConfigSchema = z.discriminatedUnion("mode", [
  stakeholdersCustomerSchema,
  stakeholdersLeadSchema,
  stakeholdersCompanyContactsSchema,
  stakeholdersStudentSchema,
  stakeholdersClientSchema,
]);

export const STAKEHOLDERS_MODES = [
  "customer",
  "lead",
  "company_contacts",
  "student",
  "client",
] as const;
export type StakeholdersMode = (typeof STAKEHOLDERS_MODES)[number];

export const stakeholdersCapability = defineCapability({
  key: "stakeholders",
  label: "Partes interessadas",
  description:
    "Papéis envolvidos no produto + canal e eventos padrão. Materializa em ProductStakeholder e StakeholderRule.",
  configSchema: stakeholdersConfigSchema,
});
