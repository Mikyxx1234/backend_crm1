/**
 * GET /api/channels/instagram/oauth/start
 *
 * Redireciona (302) o usuario para a tela de autorizacao da Meta em
 * instagram.com/oauth/authorize. O `state` assinado carrega a orgId
 * do usuario logado — validado no callback antes de persistir.
 *
 * Erros em navegacao de browser (popup) voltam HTML, nao JSON, para o
 * operador conseguir ler a causa (ex.: INSTAGRAM_APP_ID ausente).
 */
import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import {
  IgOAuthError,
  buildAuthorizeUrl,
} from "@/services/channels-instagram-oauth";

function htmlError(message: string, status: number): Response {
  const safe = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Instagram</title>
<style>body{font-family:system-ui,sans-serif;padding:24px;color:#111;max-width:420px}</style></head>
<body>
<p>Nao foi possivel iniciar o login do Instagram.</p>
<p>${safe}</p>
<p><small>Feche esta janela e use o fluxo manual (token + Webhook) se o login direto estiver indisponivel.</small></p>
</body></html>`,
    {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

function wantsHtml(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

export async function GET(request: Request) {
  return withOrgContext(async (session) => {
    try {
      const orgId = session.user.organizationId;
      if (!orgId) {
        const message = "Usuario sem organizacao ativa.";
        if (wantsHtml(request)) return htmlError(message, 400);
        return NextResponse.json({ message }, { status: 400 });
      }
      const { url } = buildAuthorizeUrl(orgId);
      return NextResponse.redirect(url, { status: 302 });
    } catch (e: unknown) {
      const status = e instanceof IgOAuthError ? e.status : 500;
      const msg =
        e instanceof IgOAuthError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Erro ao iniciar OAuth Instagram.";
      if (wantsHtml(request)) return htmlError(msg, status);
      return NextResponse.json({ message: msg }, { status });
    }
  });
}
