import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

import {
  CRM_API_PATH_HEADER,
  CRM_HTTP_METHOD_HEADER,
  CRM_REQUEST_ID_HEADER,
} from "@/lib/api-access-audit-constants";

/**
 * Mesma regra que `useSecureCookies` em `auth.config.ts` — define o nome do
 * cookie de sessão (`__Secure-` + `Secure` em HTTPS).
 */
function secureCookieFromEnv(): boolean {
  return (process.env.NEXTAUTH_URL ?? "").startsWith("https://");
}

const AUTH_SECRET = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

/**
 * Lê o JWT do cookie do pedido atual (sem `createActionURL` / NEXTAUTH_URL).
 * O wrapper `NextAuth(authConfig)` no Edge usava `NEXTAUTH_URL` fixo; se a
 * porta ou o host da barra de endereço diferirem (ex. :3001, 127.0.0.1), a
 * sessão vinha vazia e o utilizador era mandado para /login após entrar.
 */
async function readAuthFromRequestCookie(
  req: NextRequest,
): Promise<{ user?: { id: string; isSuperAdmin?: boolean } } | null> {
  if (!AUTH_SECRET) return null;
  try {
    const token = await getToken({
      req,
      secret: AUTH_SECRET,
      secureCookie: secureCookieFromEnv(),
    });
    if (!token || typeof token !== "object") return null;
    const rec = token as Record<string, unknown>;
    const id =
      typeof rec.id === "string" ? rec.id : typeof rec.sub === "string" ? rec.sub : null;
    if (!id) return null;
    return {
      user: {
        id,
        isSuperAdmin: Boolean(rec.isSuperAdmin),
      },
    };
  } catch {
    return null;
  }
}

/**
 * Headers de seguranca aplicados em TODA resposta que sai do middleware.
 *
 * - Strict-Transport-Security: forca HTTPS pros proximos 12 meses e sub-dominios.
 *   `preload` pra permitir submissao na HSTS preload list da Google (quando
 *   quisermos entrar nela). Sem efeito em ambientes HTTP puros (o Chrome
 *   ignora HSTS via HTTP).
 * - X-Content-Type-Options: nosniff — bloqueia MIME sniffing.
 * - Referrer-Policy: strict-origin-when-cross-origin — envia referer completo
 *   em requests same-origin, apenas a origem em cross-origin HTTPS, e nada
 *   em downgrade pra HTTP.
 * - X-Frame-Options: SAMEORIGIN — anti-clickjacking; so o proprio dominio
 *   pode embedar o CRM em iframe.
 * - X-DNS-Prefetch-Control: on — libera DNS prefetch pra assets externos
 *   (CDNs de fotos, Baileys, etc.) sem afetar privacidade critica.
 *
 * NAO setamos Content-Security-Policy aqui pra nao quebrar o service worker
 * / inline scripts do Next. CSP fica de TODO separado com testes.
 */
function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload",
  );
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("X-DNS-Prefetch-Control", "on");
  return res;
}

/** Request mínimo do middleware. */
type MiddlewareReq = {
  nextUrl: { pathname: string };
  headers: Headers;
  method: string;
};

/** Repassa path/método/request-id para handlers Node auditarem acesso. */
function forwardApiAuditHeaders(req: MiddlewareReq, apiPath: string): Headers {
  const h = new Headers(req.headers);
  h.set(CRM_API_PATH_HEADER, apiPath);
  h.set(CRM_HTTP_METHOD_HEADER, req.method);
  if (!h.has(CRM_REQUEST_ID_HEADER)) {
    h.set(CRM_REQUEST_ID_HEADER, crypto.randomUUID());
  }
  return h;
}

function nextWithSecurityAndAudit(req: MiddlewareReq): NextResponse {
  const pathname = req.nextUrl.pathname;
  if (pathname.startsWith("/api/")) {
    return withSecurityHeaders(
      NextResponse.next({
        request: { headers: forwardApiAuditHeaders(req, pathname) },
      }),
    );
  }
  return withSecurityHeaders(NextResponse.next());
}

const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/register",
  "/health",
  "/accept-invite",
]);

const PUBLIC_API_PATHS = new Set(["/api/signup"]);

const PWA_PUBLIC_PATHS = new Set([
  "/manifest.webmanifest",
  "/sw.js",
  "/sw.js.map",
  "/icon",
  "/icon0",
  "/icon1",
  "/icon2",
  "/icon.svg",
  "/icon-maskable.svg",
  "/apple-icon",
  "/api/push/vapid-public",
]);

export async function middleware(req: NextRequest) {
  let reqAuth: { user?: { id: string; isSuperAdmin?: boolean } } | null = null;
  try {
    reqAuth = await readAuthFromRequestCookie(req);
    const { pathname, search } = req.nextUrl;

    if (pathname.startsWith("/uploads/")) {
      const rewritten = req.nextUrl.clone();
      rewritten.pathname = `/api${pathname}`;
      rewritten.search = search;
      const apiPath = `/api${pathname}`;
      return withSecurityHeaders(
        NextResponse.rewrite(rewritten, {
          request: { headers: forwardApiAuditHeaders(req, apiPath) },
        }),
      );
    }

    if (
      pathname.startsWith("/api/auth") ||
      pathname.startsWith("/api/webhooks") ||
      pathname.startsWith("/api/health") ||
      pathname.startsWith("/api/cron") ||
      pathname.startsWith("/_next") ||
      pathname.startsWith("/favicon.ico")
    ) {
      return nextWithSecurityAndAudit(req);
    }

    if (/\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/i.test(pathname)) {
      return nextWithSecurityAndAudit(req);
    }

    if (
      PWA_PUBLIC_PATHS.has(pathname) ||
      pathname.startsWith("/swe-worker-") ||
      pathname.startsWith("/workbox-")
    ) {
      return nextWithSecurityAndAudit(req);
    }

    if (PUBLIC_PATHS.has(pathname) || PUBLIC_API_PATHS.has(pathname)) {
      return nextWithSecurityAndAudit(req);
    }

    if (
      !reqAuth &&
      pathname.startsWith("/api/") &&
      !pathname.startsWith("/api/auth") &&
      !pathname.startsWith("/api/sse")
    ) {
      const authHeader = req.headers.get("authorization") ?? "";
      if (/^Bearer\s+.+/i.test(authHeader)) {
        return nextWithSecurityAndAudit(req);
      }
    }

    if (!reqAuth) {
      const loginUrl = new URL("/login", req.nextUrl.origin);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return withSecurityHeaders(NextResponse.redirect(loginUrl));
    }

    const isSuperAdmin = Boolean(reqAuth.user?.isSuperAdmin);

    if (
      (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) &&
      !isSuperAdmin
    ) {
      if (pathname.startsWith("/api/admin")) {
        return withSecurityHeaders(
          NextResponse.json(
            { message: "Acesso restrito a administradores da plataforma." },
            { status: 403 },
          ),
        );
      }
      return withSecurityHeaders(
        NextResponse.redirect(new URL("/", req.nextUrl.origin)),
      );
    }

    return nextWithSecurityAndAudit(req);
  } catch {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    return withSecurityHeaders(NextResponse.redirect(loginUrl));
  }
}

export const config = {
  matcher: [
    "/uploads/:path*",
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
