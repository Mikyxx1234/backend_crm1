/**
 * URLs de tenant no estilo Kommo: https://{slug}.{TENANT_BASE_DOMAIN}
 *
 * Env:
 *   TENANT_BASE_DOMAIN  — default `crm.eduit.com.br`
 *   TENANT_PROTOCOL     — default `https` (use `http` em dev local)
 */

const DEFAULT_BASE_DOMAIN = "crm.eduit.com.br";
const DEFAULT_PROTOCOL = "https";

export function getTenantBaseDomain(): string {
  const raw = process.env.TENANT_BASE_DOMAIN?.trim().toLowerCase();
  return raw && raw.length > 0 ? raw.replace(/^\.+/, "") : DEFAULT_BASE_DOMAIN;
}

export function getTenantProtocol(): string {
  const raw = process.env.TENANT_PROTOCOL?.trim().toLowerCase();
  if (!raw) return DEFAULT_PROTOCOL;
  return raw.replace(/:?\/?\/?$/, "").replace(/:$/, "") || DEFAULT_PROTOCOL;
}

/** Cookie Domain com ponto inicial (ex.: `.crm.eduit.com.br`) para SSO entre subdomínios. */
export function getAuthCookieDomain(): string | undefined {
  const explicit = process.env.AUTH_COOKIE_DOMAIN?.trim();
  if (explicit === "" || explicit === "none" || explicit === "off") {
    return undefined;
  }
  if (explicit) {
    return explicit.startsWith(".") ? explicit : `.${explicit}`;
  }
  // Produção (HTTPS): compartilha cookie entre apex e `{slug}.base`.
  // Em HTTP/local não setamos Domain — cookie fica host-only.
  const nextAuthUrl = process.env.NEXTAUTH_URL ?? "";
  if (!nextAuthUrl.startsWith("https://")) return undefined;
  return `.${getTenantBaseDomain()}`;
}

export function buildTenantUrl(slug: string): string {
  const clean = String(slug ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    ?.split(".")[0];
  if (!clean) {
    throw new Error("Slug vazio para buildTenantUrl.");
  }
  return `${getTenantProtocol()}://${clean}.${getTenantBaseDomain()}`;
}

/** Alias de `buildTenantUrl`. */
export function tenantUrl(slug: string): string {
  return buildTenantUrl(slug);
}
