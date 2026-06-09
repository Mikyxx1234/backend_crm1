import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { PERMISSION_CATALOG } from "@/lib/authz/permissions";

/**
 * GET /api/permissions/catalog
 * Catálogo canônico de resources/actions para a matriz de permissões.
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

    return NextResponse.json({ resources: PERMISSION_CATALOG });
  });
}
