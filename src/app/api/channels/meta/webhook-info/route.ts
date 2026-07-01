/**
 * GET /api/channels/meta/webhook-info
 *
 * Retorna o Callback URL scoped por organizacao (para colar no painel
 * Meta -> WhatsApp -> Configuracao) e sugere um Verify Token novo aleatorio.
 *
 * Usado pela tela de criacao de canal (botao "Webhook") para o cliente
 * que quer configurar o webhook no proprio App Meta -- fluxo alternativo
 * ao provisionamento automatico via subscribed_apps do App Meta global.
 *
 * O Verify Token retornado deve ser enviado depois no POST /api/channels/manual-cloud
 * como campo `verifyToken` para persistir no `Channel.config.verifyToken`
 * antes de o cliente clicar "Verify and save" no painel Meta.
 */
import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";

const VERIFY_TOKEN_CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const VERIFY_TOKEN_LEN = 40;

function generateVerifyToken(): string {
  const bytes = new Uint8Array(VERIFY_TOKEN_LEN);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += VERIFY_TOKEN_CHARSET[bytes[i] % VERIFY_TOKEN_CHARSET.length];
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
    // Sem slug: a URL slugless usa o handler legacy, que agora aceita
    // Channel.config.verifyToken de qualquer canal (any-match). Assim o
    // cliente configura o painel Meta com uma URL fixa e o token
    // per-channel gerado aqui valida o handshake normalmente.
    const callbackUrl = `${base}/api/webhooks/meta`;

    // Warning: se a base veio de header (x-forwarded-host / host), pode
    // estar apontando pro dominio errado (ex.: frontend proxying a request).
    // Nesses casos o operator deve setar BACKEND_PUBLIC_URL no deploy.
    const isFromHeader = source.startsWith("header:") || source === "request.url";

    return NextResponse.json({
      callbackUrl,
      verifyToken: generateVerifyToken(),
      resolvedFrom: source,
      warning: isFromHeader
        ? "URL derivada de header HTTP. Se apontar pro dominio errado, configure BACKEND_PUBLIC_URL no deploy do backend."
        : null,
    });
  });
}
