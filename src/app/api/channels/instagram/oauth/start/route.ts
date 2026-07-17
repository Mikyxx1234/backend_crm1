/**
 * GET /api/channels/instagram/oauth/start
 *
 * Redireciona (302) o usuario para a tela de autorizacao da Meta em
 * instagram.com/oauth/authorize. O `state` assinado carrega a orgId
 * do usuario logado — validado no callback antes de persistir.
 */
import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import {
  IgOAuthError,
  buildAuthorizeUrl,
} from "@/services/channels-instagram-oauth";

export async function GET() {
  return withOrgContext(async (session) => {
    try {
      const orgId = session.user.organizationId;
      if (!orgId) {
        return NextResponse.json(
          { message: "Usuario sem organizacao ativa." },
          { status: 400 },
        );
      }
      const { url } = buildAuthorizeUrl(orgId);
      return NextResponse.redirect(url, { status: 302 });
    } catch (e: unknown) {
      if (e instanceof IgOAuthError) {
        return NextResponse.json({ message: e.message }, { status: e.status });
      }
      const msg = e instanceof Error ? e.message : "Erro ao iniciar OAuth Instagram.";
      return NextResponse.json({ message: msg }, { status: 500 });
    }
  });
}
