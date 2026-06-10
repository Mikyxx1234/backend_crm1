/**
 * Helpers do catalogo de widgets (marketplace).
 *
 * Historicamente este arquivo era a FONTE DA VERDADE do catalogo (array
 * estatico `AVAILABLE_WIDGETS`). A partir do marketplace de widgets, a
 * fonte virou a tabela `Widget` no Postgres — populada por seed (widgets
 * internos) e pelo `partner_portal_crm1` (widgets de parceiros).
 *
 * Aqui ficou apenas:
 *   - Tipo compartilhado `WidgetDefinition` (shape lido do DB pelo service).
 *   - Helpers puros (`isReservedPartnerSlug`, validacao de slug) usados pelo
 *     portal e pelo backend.
 *
 * Quem precisa LISTAR widgets deve usar `listWidgetsWithState()` de
 * `@/services/organization-widgets` (consulta o banco).
 */

/** Disponibilidade visual no card. NAO confundir com `WidgetStatus`
 *  (DRAFT/ONLINE/OFFLINE) que controla se o widget aparece no marketplace. */
export type WidgetAvailability = "available" | "coming_soon";

/** Origem do widget — INTERNAL (renderizado por rota propria do CRM)
 *  ou PARTNER (iframe externo hospedado pelo parceiro). */
export type WidgetOwnerType = "INTERNAL" | "PARTNER";

/** Status de publicacao no marketplace. */
export type WidgetStatus = "DRAFT" | "ONLINE" | "OFFLINE";

export interface WidgetDefinition {
  /** snake_case unico — gravado em `OrganizationWidget.widgetSlug`. */
  slug: string;
  name: string;
  description: string;
  /** Para INTERNAL: chave de icone resolvida no frontend (ex.: "route").
   *  Para PARTNER: URL absoluta do icone. */
  icon: string;
  category: string;
  /** Bullets curtos exibidos no card (vazio = so descricao). */
  features: string[];
  availability: WidgetAvailability;
  ownerType: WidgetOwnerType;
  /** Null para INTERNAL. */
  partnerAccountId: string | null;
  /** Null para INTERNAL — renderizado por rota propria no CRM. */
  iframeUrl: string | null;
  /** Nome do parceiro (preenchido no service quando ownerType=PARTNER). */
  partnerName?: string | null;
}

/** Prefixos reservados — parceiros NAO podem usar slugs comecando com
 *  esses prefixos pra evitar colisao com widgets internos do CRM. */
export const RESERVED_SLUG_PREFIXES = ["core_", "crm_"] as const;

/** True se o slug colide com um prefixo reservado (`core_*`, `crm_*`). */
export function isReservedPartnerSlug(slug: string): boolean {
  const lower = slug.trim().toLowerCase();
  return RESERVED_SLUG_PREFIXES.some((p) => lower.startsWith(p));
}

/** Regex de formato de slug — snake_case alfanumerico. */
export const WIDGET_SLUG_REGEX = /^[a-z][a-z0-9_]{2,49}$/;

/** True se o slug tem formato valido (snake_case, 3-50 chars). */
export function isValidWidgetSlug(slug: string): boolean {
  return WIDGET_SLUG_REGEX.test(slug);
}
