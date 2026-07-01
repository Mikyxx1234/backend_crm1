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
import { prismaBase } from "@/lib/prisma-base";

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

function backendBaseUrl(request: Request): string {
  // Prioridade: env explicita (config de deploy). Em produtos Easypanel /
  // atras de proxy reverso, `request.url` chega com o host interno
  // (0.0.0.0:3000), o que nao serve pro cliente colar no painel Meta.
  const envBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (envBase) return envBase.replace(/\/$/, "");

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedHost) {
    const proto = forwardedProto?.split(",")[0]?.trim() || "https";
    return `${proto}://${forwardedHost.split(",")[0]?.trim()}`;
  }

  const hostHeader = request.headers.get("host");
  if (hostHeader && !hostHeader.startsWith("0.0.0.0") && !hostHeader.startsWith("127.")) {
    const proto = forwardedProto || "https";
    return `${proto}://${hostHeader}`;
  }

  try {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
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

    const org = await prismaBase.organization.findUnique({
      where: { id: orgId },
      select: { slug: true },
    });

    const slug = org?.slug ?? "";
    const base = backendBaseUrl(request);
    const callbackUrl = slug
      ? `${base}/api/webhooks/meta/${slug}`
      : `${base}/api/webhooks/meta`;

    return NextResponse.json({
      callbackUrl,
      verifyToken: generateVerifyToken(),
      organizationSlug: slug,
    });
  });
}
