import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { resolveMetaTemplatesClient } from "@/lib/meta-whatsapp/resolve-templates-client";
import {
  getFlowDefinitionById,
  syncFlowFieldsFromMeta,
} from "@/services/whatsapp-flow-definitions";

function requireAdminOrManager(session: { user?: { role?: string } }): NextResponse | null {
  const r = session.user?.role;
  if (r !== "ADMIN" && r !== "MANAGER") {
    return NextResponse.json({ message: "Apenas administrador ou gestor." }, { status: 403 });
  }
  return null;
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    const denied = requireAdminOrManager(session);
    if (denied) return denied;

    const { id } = await context.params;
    if (!id) return NextResponse.json({ message: "ID inválido." }, { status: 400 });

    const resolved = await resolveMetaTemplatesClient({
      organizationId: session.user.organizationId,
      isSuperAdmin: session.user.isSuperAdmin,
    });
    if (!resolved.ok) return resolved.response;

    try {
      await syncFlowFieldsFromMeta(id, resolved.client);
      const row = await getFlowDefinitionById(id);
      return NextResponse.json(row);
    } catch (e) {
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro ao sincronizar." },
        { status: 400 },
      );
    }
  });
}
