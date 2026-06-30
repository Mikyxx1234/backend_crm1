/**
 * Schemas Zod e tipos do cliente Api4com.
 *
 * Cobre os endpoints usados na integração:
 *   POST /users/accessTokens
 *   POST /users
 *   GET  /users
 *   POST /extensions/nextAvailable
 *   PATCH /integrations
 *   POST /dialer
 *   DELETE /dialer/:id  (hangup)
 *
 * Fonte de verdade: .cursor/rules/api4com.mdc.
 */
import { z } from "zod";

// ── Access tokens ─────────────────────────────────────────────────────────

export const AccessTokenResponseSchema = z.object({
  id: z.string().min(1),
});
export type AccessTokenResponse = z.infer<typeof AccessTokenResponseSchema>;

// ── Users ─────────────────────────────────────────────────────────────────

export const Api4ComUserRoleSchema = z.enum(["USER", "ADMIN"]);
export type Api4ComUserRole = z.infer<typeof Api4ComUserRoleSchema>;

export const CreateUserRequestSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  role: Api4ComUserRoleSchema.default("USER"),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const Api4ComUserSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  email: z.string().email().optional(),
  role: Api4ComUserRoleSchema.optional(),
});
export type Api4ComUser = z.infer<typeof Api4ComUserSchema>;

// ── Extensions ────────────────────────────────────────────────────────────

export const Api4ComExtensionResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  ramal: z.union([z.string(), z.number()]).transform((v) => String(v)),
  senha: z.string(),
  domain: z.string(),
  bina: z.string().optional(),
  email_address: z.string().optional(),
});
export type Api4ComExtensionResponse = z.infer<typeof Api4ComExtensionResponseSchema>;

// ── Integrations (webhook config) ─────────────────────────────────────────

export const IntegrationPatchSchema = z.object({
  gateway: z.string().min(1),
  webhook: z.boolean().default(true),
  webhookConstraint: z.object({
    metadata: z.object({ gateway: z.string().min(1) }),
  }),
  metadata: z.object({
    webhookUrl: z.string().url(),
    webhookVersion: z.string().min(1),
    webhookTypes: z.array(z.string()).min(1),
  }),
});
export type IntegrationPatch = z.infer<typeof IntegrationPatchSchema>;

// ── Dialer ────────────────────────────────────────────────────────────────

export const DialerRequestSchema = z.object({
  extension: z.string().min(1),
  /** E.164 (+55…) — normalização é responsabilidade do caller. */
  phone: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type DialerRequest = z.infer<typeof DialerRequestSchema>;

export const DialerAckSchema = z.object({
  /** NÃO é o id real da chamada — usado só para hangup. O id real chega no webhook. */
  id: z.string().optional(),
  message: z.string().optional(),
});
export type DialerAck = z.infer<typeof DialerAckSchema>;
