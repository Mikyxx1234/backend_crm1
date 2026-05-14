import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { resolveMetaTemplatesClient } from "@/lib/meta-whatsapp/resolve-templates-client";

type RouteContext = { params: Promise<{ id: string }> };

function requireAdminOrManager(session: { user?: { role?: string } }): NextResponse | null {
  const r = session.user?.role;
  if (r !== "ADMIN" && r !== "MANAGER") {
    return NextResponse.json({ message: "Apenas administrador ou gestor." }, { status: 403 });
  }
  return null;
}

/** DELETE: remove template pelo ID Graph (campo `id` na listagem). */
export async function DELETE(_request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    try {
      const roleDenied = requireAdminOrManager(session);
      if (roleDenied) return roleDenied;

      const resolved = await resolveMetaTemplatesClient({
        organizationId: session.user.organizationId,
        isSuperAdmin: session.user.isSuperAdmin,
      });
      if (!resolved.ok) return resolved.response;

      const { id } = await context.params;
      if (!id?.trim()) {
        return NextResponse.json({ message: "ID inválido." }, { status: 400 });
      }

      const data = await resolved.client.deleteMessageTemplate(id.trim());
      return NextResponse.json(data ?? { success: true });
    } catch (e: unknown) {
      console.error("[meta-templates] DELETE", e);
      const msg = e instanceof Error ? e.message : "Erro ao excluir template na Meta.";
      return NextResponse.json({ message: msg }, { status: 502 });
    }
  });
}
