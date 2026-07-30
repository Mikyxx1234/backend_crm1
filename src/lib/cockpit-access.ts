import type { RequestContext } from "@/lib/request-context";

const COCKPIT_USER_ID = "cockpit-monitor";

/**
 * Autenticação interna do painel operacional (URL dedicada, ex. cockpit
 * DataCrazy migrado). Configurada uma vez no EasyPanel — o operador só
 * abre a URL, sem colar token no browser.
 *
 * Env no backend CRM:
 *   COCKPIT_ACCESS_SECRET  — segredo compartilhado (header X-Cockpit-Access)
 *   COCKPIT_ORGANIZATION_ID — org cujas métricas serão exibidas
 */
export function tryCockpitAccessAuth(request: Request): RequestContext | null {
  const secret = process.env.COCKPIT_ACCESS_SECRET?.trim();
  const orgId = process.env.COCKPIT_ORGANIZATION_ID?.trim();
  if (!secret || !orgId) return null;

  const header = (request.headers.get("x-cockpit-access") ?? "").trim();
  if (!header || header !== secret) return null;

  return {
    organizationId: orgId,
    userId: COCKPIT_USER_ID,
    isSuperAdmin: false,
    actor: { type: "INTEGRATION", label: "Cockpit monitor" },
  };
}

/** Origens permitidas no CORS do cockpit (domínio dedicado do painel). */
export function cockpitCorsOrigin(request: Request): string | null {
  const raw = process.env.COCKPIT_ALLOWED_ORIGINS?.trim();
  if (!raw) return null;
  const allowed = raw.split(",").map((s) => s.trim().replace(/\/$/, ""));
  const origin = (request.headers.get("origin") ?? "").trim().replace(/\/$/, "");
  if (!origin) return allowed[0] ?? null;
  return allowed.includes(origin) ? origin : null;
}

export function cockpitCorsHeaders(request: Request): Record<string, string> {
  const origin = cockpitCorsOrigin(request);
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, X-Cockpit-Access, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
