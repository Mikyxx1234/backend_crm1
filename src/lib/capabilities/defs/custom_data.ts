/**
 * Capacidade: custom_data (campos personalizados por produto/catálogo).
 *
 * Reusa o sistema de custom fields existente; a config apenas declara quais
 * grupos/campos a capacidade habilita. Sem lógica vertical.
 */

import { z } from "zod";

import { defineCapability } from "../types";

export const customDataConfigSchema = z.object({
  fieldGroupKeys: z
    .array(z.string().trim().min(1))
    .default([])
    .meta({
      title: "Grupos de campos",
      description: "Chaves de grupos de custom fields habilitados.",
    }),
  requireOnCreate: z.boolean().default(false).meta({
    title: "Obrigatório na criação?",
    description: "Se ligado, os campos são exigidos ao criar o produto/deal.",
  }),
});

export const customDataCapability = defineCapability({
  key: "custom_data",
  label: "Dados personalizados",
  description: "Campos personalizados extras vinculados ao produto ou catálogo.",
  configSchema: customDataConfigSchema,
});
