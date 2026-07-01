/**
 * GET /api/channels/meta/webhook-info
 *
 * Retorna Callback URL + Verify Token + Webhook ID (per-channel, aleatorios).
 * A URL usa um id aleatorio no path (`/api/webhooks/meta/<webhookId>`) em
 * vez do slug da organizacao -- URL opaca por canal.
 *
 * Fluxo:
 *   1. Usuario clica "Webhook" no dialog de criacao -> este endpoint.
 *   2. Cola callbackUrl + verifyToken no painel Meta.
 *   3. Ao clicar "Criar canal", o frontend passa `webhookId` + `verifyToken`
 *      pro POST /api/channels/manual-cloud, que persiste ambos em
 *      Channel.config -- assim a rota /api/webhooks/meta/<webhookId>
 *      resolve corretamente o canal + org na hora do handshake e das
 *      mensagens de entrada.
 */
import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";

const CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function generateRandomId(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += CHARSET[bytes[i] % CHARSET.length];
  }
  return out;
}

function backendBaseUrl(request: Request): { base: string; source: string } {
  // Prioridade: env explicita do BACKEND. Em Easypanel / proxy reverso,
  // a request pode vir pelo rewrite do frontend, entao `x-forwarded-host`
  // e o dominio do frontend -- errado pra Meta chamar de volta.
  //
  // Setar no deploy do backend uma dessas envs (aponta pra si mesmo):
  //   BACKEND_PUBLIC_URL=https://seu-backend.easypanel.host
  //   ou NEXT_PUBLIC_API_BASE_URL=https://seu-backend.easypanel.host
  const envBackend = process.env.BACKEND_PUBLIC_URL?.trim();
  if (envBackend) return { base: envBackend.replace(/\/$/, ""), source: "env:BACKEND_PUBLIC_URL" };

  const envApi = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (envApi) return { base: envApi.replace(/\/$/, ""), source: "env:NEXT_PUBLIC_API_BASE_URL" };

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedHost) {
    const proto = forwardedProto?.split(",")[0]?.trim() || "https";
    return {
      base: `${proto}://${forwardedHost.split(",")[0]?.trim()}`,
      source: "header:x-forwarded-host",
    };
  }

  const hostHeader = request.headers.get("host");
  if (hostHeader && !hostHeader.startsWith("0.0.0.0") && !hostHeader.startsWith("127.")) {
    const proto = forwardedProto || "https";
    return { base: `${proto}://${hostHeader}`, source: "header:host" };
  }

  try {
    const url = new URL(request.url);
    return { base: `${url.protocol}//${url.host}`, source: "request.url" };
  } catch {
    return { base: "", source: "none" };
  }
}

export async function GET(request: Request) {
  return withOrgContext(async (session) => {
    const orgId = session.user.organizationId;
    if (!orgId) {
      return NextResponse.json(
        { message: "Sem organizacao no contexto." },
        { status: 403 },
      );
    }

    const { base, source } = backendBaseUrl(request);
    // Id aleatorio por canal: URL opaca, nao vaza slug/nome da org.
    // Persistido em Channel.config.webhookId no POST /api/channels/manual-cloud.
    const webhookId = generateRandomId(24);
    const verifyToken = generateRandomId(40);
    const callbackUrl = `${base}/api/webhooks/meta/${webhookId}`;

    // Warning: se a base veio de header (x-forwarded-host / host), pode
    // estar apontando pro dominio errado (ex.: frontend proxying a request).
    // Nesses casos o operator deve setar BACKEND_PUBLIC_URL no deploy.
    const isFromHeader = source.startsWith("header:") || source === "request.url";

    return NextResponse.json({
      callbackUrl,
      verifyToken,
      webhookId,
      resolvedFrom: source,
      warning: isFromHeader
        ? "URL derivada de header HTTP. Se apontar pro dominio errado, configure BACKEND_PUBLIC_URL no deploy do backend."
        : null,
    });
  });
}
