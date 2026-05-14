/**
 * Builders de cache key + helpers de invalidacao (PR 5.1).
 *
 * Centralizar aqui evita typo entre callers e permite refactor em
 * massa sem caca-fantasmas. NAO concatenar strings ad-hoc nas rotas
 * — sempre via builder.
 */
import { cache } from "./index";

// ── Channel ─────────────────────────────────────────────────────
//
// Usado em hot paths:
//   - meta-webhook handler (lookup por id)
//   - send-whatsapp (lookup por id)
//   - automation-executor (lookup por id)

export function channelKey(id: string): string {
  return `channel:${id}`;
}

export async function invalidateChannel(id: string): Promise<void> {
  await cache.del(channelKey(id));
}

// ── AIAgentConfig ───────────────────────────────────────────────
//
// 1:1 com User. Carregado em cada turn de bot.

export function aiAgentConfigKey(userId: string): string {
  return `ai_agent:${userId}`;
}

export async function invalidateAiAgentConfig(userId: string): Promise<void> {
  await cache.del(aiAgentConfigKey(userId));
}

// ── Organization ────────────────────────────────────────────────
//
// Lookup por slug em SSR de /onboarding e branding publico.

export function organizationBySlugKey(slug: string): string {
  return `org_slug:${slug.toLowerCase()}`;
}

export function organizationByIdKey(id: string): string {
  return `org:${id}`;
}

export async function invalidateOrganization(opts: {
  id?: string;
  slug?: string;
}): Promise<void> {
  const keys: string[] = [];
  if (opts.id) keys.push(organizationByIdKey(opts.id));
  if (opts.slug) keys.push(organizationBySlugKey(opts.slug));
  if (keys.length > 0) await cache.del(...keys);
}

// ── Settings (Organization-level config livre) ──────────────────
//
// Pra futuros toggles e branding — chave unica por org.

export function organizationSettingsKey(orgId: string): string {
  return `org_settings:${orgId}`;
}

export async function invalidateOrganizationSettings(orgId: string): Promise<void> {
  await cache.del(organizationSettingsKey(orgId));
}

// ── User (apenas campos hot) ────────────────────────────────────
//
// USE COM CUIDADO. User muda raramente mas alteracoes precisam ser
// vistas rapido (role, isErased, status org). TTL curto = 30s.

export function userKey(id: string): string {
  return `user:${id}`;
}

export async function invalidateUser(id: string): Promise<void> {
  await cache.del(userKey(id));
}

// ── Pipelines / Stages (config raramente muda) ──────────────────
//
// Listagem completa por org. Invalidar em mudanca de pipeline/stage.

export function pipelinesKey(orgId: string): string {
  return `pipelines:${orgId}`;
}

export async function invalidatePipelines(orgId: string): Promise<void> {
  await cache.del(pipelinesKey(orgId));
}
