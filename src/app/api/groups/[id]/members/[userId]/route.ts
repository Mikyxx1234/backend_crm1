import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { removeGroupMember } from "@/services/groups";

type RouteContext = { params: Promise<{ id: string; userId: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
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

    const { id, userId } = await context.params;
    try {
      const result = await removeGroupMember(id, userId);
      if (!result) {
        return NextResponse.json({ message: "Membro não encontrado." }, { status: 404 });
      }
      return NextResponse.json(result);
    } catch (e) {
      console.error("[DELETE /api/groups/[id]/members/[userId]]", e);
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro ao remover membro." },
        { status: 400 },
      );
    }
  });
}
