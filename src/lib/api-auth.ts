import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { checkRateLimit, setRateLimitHeaders } from "@/lib/rate-limiter";
import { validateToken } from "@/services/api-tokens";

export type ApiUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type ApiAuthResult =
  | { ok: true; user: ApiUser; viaToken: boolean }
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
      const res = NextResponse.json(
        { message: "Limite de requisições excedido. Tente novamente em breve." },
        { status: 429 }
      );
      setRateLimitHeaders(res.headers, rl);
      return { ok: false, response: res };
    }

    return {
      ok: true,
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
      },
      viaToken: true,
    };
  }

  const session = await auth();
  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json(
        { message: "Não autorizado." },
        { status: 401 }
      ),
    };
  }

  return {
    ok: true,
    user: {
      id: session.user.id,
      name: session.user.name ?? "",
      email: session.user.email ?? "",
      role: (session.user as { role?: string }).role ?? "MEMBER",
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
