import { NextResponse } from "next/server";

import { logApiAccessAuthReject, logApiAccessCompleted, resolveResponseStatus } from "@/lib/api-access-audit";
import { auth } from "@/lib/auth";
import { checkRateLimit, setRateLimitHeaders } from "@/lib/rate-limiter";
import { validateToken } from "@/services/api-tokens";
import {
  enterRequestContext,
  runWithContext,
  type RequestContext,
} from "@/lib/request-context";

export type ApiUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  /// Orgid resolvido do ApiToken (Bearer) ou do session.user (NextAuth).
  /// Null so quando o caller e super-admin global (sem vinculo com org).
  organizationId: string | null;
  isSuperAdmin: boolean;
};

export type ApiAuthResult =
  | { ok: true; user: ApiUser; viaToken: boolean; tokenHash?: string }
  | { ok: false; response: NextResponse };

export async function authenticateApiRequest(
  request: Request
): Promise<ApiAuthResult> {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (match) {
    const rawToken = match[1];
    const result = await validateToken(rawToken);

    if (!result) {
      logApiAccessAuthReject(request, { reason: "invalid_bearer_token", status: 401, via: "bearer" });
      return {
        ok: false,
        response: NextResponse.json(
          { message: "Token inválido ou expirado." },
          { status: 401 }
        ),
      };
    }

    const rl = checkRateLimit(`token:${result.tokenHash}`);
    if (!rl.allowed) {
      logApiAccessAuthReject(request, { reason: "bearer_rate_limited", status: 429, via: "bearer" });
      const res = NextResponse.json(
        { message: "Limite de requisições excedido. Tente novamente em breve." },
        { status: 429 }
      );
      setRateLimitHeaders(res.headers, rl);
      return { ok: false, response: res };
    }

    // Ativa o ctx ja aqui pra qualquer prisma.* seguinte no handler
    // funcionar sem precisar envolver em `withApiAuthContext`. Rotas
    // que usam a forma nova (runWithContext) sobrescrevem idempotente.
    enterRequestContext({
      organizationId: result.organizationId,
      userId: result.user.id,
      isSuperAdmin: result.user.isSuperAdmin,
    });

    return {
      ok: true,
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
        organizationId: result.organizationId,
        isSuperAdmin: result.user.isSuperAdmin,
      },
      viaToken: true,
      tokenHash: result.tokenHash,
    };
  }

  const session = await auth();
  if (!session?.user?.id) {
    logApiAccessAuthReject(request, { reason: "no_session", status: 401, via: "session" });
    return {
      ok: false,
      response: NextResponse.json(
        { message: "Não autorizado." },
        { status: 401 }
      ),
    };
  }

  const sessionUser = session.user as {
    id: string;
    name?: string | null;
    email?: string | null;
    role?: string;
    organizationId?: string | null;
    isSuperAdmin?: boolean;
  };

  if (!sessionUser.isSuperAdmin && !sessionUser.organizationId) {
    logApiAccessAuthReject(request, { reason: "session_missing_organization", status: 401, via: "session" });
    return {
      ok: false,
      response: NextResponse.json(
        { message: "Sessão sem organização." },
        { status: 401 }
      ),
    };
  }

  // ATENCAO: NAO chamar enterRequestContext aqui. Ele usa enterWith()
  // que so se propaga pra continuations FILHAS — quando o handler
  // resume apos `const r = await authenticateApiRequest(req)`, o
  // store ja se foi (parent continuation nao herdou). Use
  // `withApiAuthContext(req, handler)` em vez de chamar este helper
  // direto, ou envolva o handler em runWithContext manualmente.
  return {
    ok: true,
    user: {
      id: sessionUser.id,
      name: sessionUser.name ?? "",
      email: sessionUser.email ?? "",
      role: sessionUser.role ?? "MEMBER",
      organizationId: sessionUser.organizationId ?? null,
      isSuperAdmin: Boolean(sessionUser.isSuperAdmin),
    },
    viaToken: false,
  };
}

export function withRateLimitHeaders(
  response: NextResponse,
  tokenHash?: string
): NextResponse {
  if (tokenHash) {
    const rl = checkRateLimit(`token:${tokenHash}`, 400);
    setRateLimitHeaders(response.headers, rl);
  }
  return response;
}

/**
 * Wrapper que roda o handler em contexto tenant-scoped usando o
 * organizationId resolvido pelo Bearer/session. Substitui o padrao de
 * authenticateApiRequest + executar logica — a vantagem eh garantir
 * que a Prisma Extension e a RLS tenham acesso ao ctx sem esforco.
 */
export async function withApiAuthContext<T>(
  request: Request,
  handler: (user: ApiUser) => Promise<T> | T,
): Promise<NextResponse | T> {
  const r = await authenticateApiRequest(request);
  if (!r.ok) return r.response;
  const ctx: RequestContext = {
    organizationId: r.user.organizationId,
    userId: r.user.id,
    isSuperAdmin: r.user.isSuperAdmin,
  };
  const method = request.method;
  let path = "";
  try {
    path = new URL(request.url).pathname;
  } catch {
    path = "";
  }
  const t0 = Date.now();
  try {
    const out = (await runWithContext(ctx, () => handler(r.user))) as T;
    const durationMs = Date.now() - t0;
    const status = resolveResponseStatus(out);
    void logApiAccessCompleted({
      method,
      path,
      status,
      durationMs,
      userId: r.user.id,
      organizationId: r.user.organizationId,
    });
    return out;
  } catch (err) {
    const durationMs = Date.now() - t0;
    void logApiAccessCompleted({
      method,
      path,
      status: 500,
      durationMs,
      userId: r.user.id,
      organizationId: r.user.organizationId,
    });
    throw err;
  }
}

/**
 * Helper compacto pra rotas que ja chamam authenticateApiRequest direto
 * (legado) — envolve a lambda em runWithContext usando o user resolvido.
 *
 * Use quando refatorar pra `withApiAuthContext` for muito invasivo. O
 * resultado eh equivalente: tudo dentro da lambda enxerga o ctx via
 * getOrgIdOrThrow(), prisma extension scopa por org, etc.
 */
export function runWithApiUserContext<T>(
  user: ApiUser,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return runWithContext(
    {
      organizationId: user.organizationId,
      userId: user.id,
      isSuperAdmin: user.isSuperAdmin,
    },
    fn,
  );
}
