/**
 * SSO de widgets do marketplace.
 *
 * Quando um usuario abre um widget de parceiro instalado, o CRM gera um
 * JWT curto (5 min) com o contexto da sessao + slug do widget. O CRM
 * embeda o iframe do parceiro com esse token (`?token=...`); o backend
 * do parceiro chama `POST /api/public/widgets/sso/verify` pra validar a
 * assinatura e ler o payload.
 *
 * Por que `WIDGET_SSO_SECRET` separado do `AUTH_SECRET`?
 *   - Escopo isolado: comprometer o segredo do SSO de widgets nao da
 *     acesso a sessoes do CRM (cookies/jwt do NextAuth).
 *   - Permite rotacionar independente sem deslogar usuarios.
 *   - Em dev cai num fallback derivado do `AUTH_SECRET` pra nao quebrar
 *     setups locais; em prod e obrigatorio.
 */

import { SignJWT, jwtVerify, errors as joseErrors } from "jose";

/** TTL do token SSO — curto pra forcar refresh ao abrir/recarregar o widget. */
const SSO_TOKEN_TTL_SECONDS = 300; // 5 min
/** Issuer estavel no token — facilita auditoria / proxy / multi-instancia. */
const SSO_ISSUER = "crm-widgets-sso";
/** Audience tem o slug do widget — parceiro pode rejeitar token destinado
 *  a outro widget (defesa em profundidade). */
function audienceForSlug(slug: string): string {
  return `widget:${slug}`;
}

/** Carrega o segredo. Em prod, fail-loud se nao houver
 *  `WIDGET_SSO_SECRET`. Em dev, cai pro `AUTH_SECRET` (com prefixo) pra
 *  facilitar setup local sem variavel nova. */
function getSecret(): Uint8Array {
  const explicit = process.env.WIDGET_SSO_SECRET;
  if (explicit && explicit.length >= 32) {
    return new TextEncoder().encode(explicit);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "WIDGET_SSO_SECRET ausente ou curto (<32 chars) em producao. " +
        "Defina uma string aleatoria forte e independente de AUTH_SECRET.",
    );
  }
  const fallback = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!fallback) {
    throw new Error(
      "Nem WIDGET_SSO_SECRET nem AUTH_SECRET definidos — impossivel emitir token SSO.",
    );
  }
  return new TextEncoder().encode(`widget-sso:${fallback}`);
}

export interface WidgetSsoPayload {
  /** ID da organizacao logada que esta abrindo o widget. */
  orgId: string;
  /** Nome legivel da organizacao (display no app do parceiro). */
  orgName: string;
  /** ID do usuario do CRM que disparou a abertura. */
  userId: string;
  /** Nome do usuario. */
  userName: string;
  /** Email do usuario. */
  userEmail: string;
  /** Slug do widget a que este token se destina. */
  widgetSlug: string;
}

/**
 * Emite um JWT HS256 com o payload SSO. Inclui `iat`, `exp` (5min) e
 * `aud=widget:<slug>` automaticamente.
 */
export async function issueWidgetSsoToken(payload: WidgetSsoPayload): Promise<string> {
  const secret = getSecret();
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SSO_ISSUER)
    .setAudience(audienceForSlug(payload.widgetSlug))
    .setIssuedAt()
    .setExpirationTime(`${SSO_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export interface VerifyResult {
  valid: boolean;
  /** Preenchido quando `valid=true`. */
  payload?: WidgetSsoPayload & { iat: number; exp: number };
  /** Codigo curto descritivo do motivo de falha. */
  reason?:
    | "missing"
    | "expired"
    | "invalid_signature"
    | "invalid_payload"
    | "malformed";
}

/**
 * Valida um token SSO. Nao exige `audience` (parceiro nao sabe
 * antecipadamente o widgetSlug se nao quiser), mas devolve no payload
 * pra ele verificar manualmente.
 */
export async function verifyWidgetSsoToken(token: string | undefined | null): Promise<VerifyResult> {
  if (!token || typeof token !== "string") return { valid: false, reason: "missing" };
  const secret = getSecret();
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: SSO_ISSUER,
    });
    const required = ["orgId", "orgName", "userId", "userName", "userEmail", "widgetSlug"] as const;
    for (const k of required) {
      if (typeof (payload as Record<string, unknown>)[k] !== "string") {
        return { valid: false, reason: "invalid_payload" };
      }
    }
    return {
      valid: true,
      payload: {
        orgId: payload.orgId as string,
        orgName: payload.orgName as string,
        userId: payload.userId as string,
        userName: payload.userName as string,
        userEmail: payload.userEmail as string,
        widgetSlug: payload.widgetSlug as string,
        iat: payload.iat ?? 0,
        exp: payload.exp ?? 0,
      },
    };
  } catch (e) {
    if (e instanceof joseErrors.JWTExpired) return { valid: false, reason: "expired" };
    if (e instanceof joseErrors.JWSSignatureVerificationFailed) {
      return { valid: false, reason: "invalid_signature" };
    }
    return { valid: false, reason: "malformed" };
  }
}
