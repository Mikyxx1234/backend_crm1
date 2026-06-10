import { NextResponse } from "next/server";

import { getLogger } from "@/lib/logger";
import { getClientIp, withRateLimit } from "@/lib/rate-limit";
import { verifyWidgetSsoToken } from "@/services/widget-sso";

const log = getLogger("widgets.sso.verify");

/**
 * POST /api/public/widgets/sso/verify
 *
 * Endpoint PUBLICO (sem auth) que parceiros chamam pra validar o JWT
 * recebido no iframe. CORS permissivo (`*`) — a confianca esta toda na
 * assinatura HMAC do JWT (segredo `WIDGET_SSO_SECRET`).
 *
 * Body: `{ token: string }`
 * Resposta 200: `{ valid: true, payload: {...} }` ou
 *               `{ valid: false, reason: "expired"|... }`
 *
 * Importante: NAO usa `withOrgContext` — o JWT eh self-contained, sem
 * cookie de sessao. O parceiro pode chamar do backend dele sem precisar
 * estar logado em nenhuma org do CRM.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  // Rate limit POR IP — endpoint publico sem cookie, alvo natural pra
  // brute-force (cada verify roda HMAC, que custa CPU). 10/min eh o
  // perfil `auth.public` que ja usamos pra login/signup.
  const rl = await withRateLimit({
    route: "POST /api/public/widgets/sso/verify",
    profile: "auth.public",
    scope: "ip",
    id: getClientIp(request),
  });
  if (!rl.ok) {
    // Mantem CORS pra resposta 429 ser legivel pelo browser.
    Object.entries(CORS_HEADERS).forEach(([k, v]) => rl.response.headers.set(k, v));
    return rl.response;
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { valid: false, reason: "malformed" },
      { status: 400, headers: { ...CORS_HEADERS, ...rl.headers } },
    );
  }
  const token =
    typeof (body as { token?: unknown } | null)?.token === "string"
      ? ((body as { token: string }).token as string)
      : "";

  const result = await verifyWidgetSsoToken(token);
  // Telemetria estruturada por `reason` — facil agregar no log/grafana
  // pra detectar parceiros tendo problema (muitos `expired` seguidos
  // pode indicar relogio fora de sincronia, por exemplo).
  if (result.valid) {
    log.debug(
      { slug: result.payload?.widgetSlug, ip: getClientIp(request) },
      "verify ok",
    );
  } else {
    log.info(
      { reason: result.reason, ip: getClientIp(request) },
      "verify failed",
    );
  }
  // Sempre 200 (mesmo invalido): o consumidor decide. Evita confundir
  // erro de rede com token expirado.
  return NextResponse.json(result, {
    status: 200,
    headers: { ...CORS_HEADERS, ...rl.headers },
  });
}
