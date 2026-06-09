import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";

/**
 * GET /api/groups
 * Grupos (Fase 3) — modelo ainda não migrado. Retorna lista vazia
 * para a UI de permissões não quebrar com 404.
 */
export async function GET() {
  return withOrgContext(async (session) => {
    const ctx = await loadAuthzContext({
      userId: session.user.id,
      organizationId: session.user.organizationId,
      isSuperAdmin: session.user.isSuperAdmin,
    });
    if (!can(ctx, "settings:permissions")) {
      return NextResponse.json(
        { message: "Acesso negado.", required: "settings:permissions" },
        { status: 403 },
      );
    }

    return NextResponse.json([]);
  });
}

export async function POST() {
  return NextResponse.json(
    { message: "Grupos ainda não disponíveis nesta versão." },
    { status: 501 },
  );
}
