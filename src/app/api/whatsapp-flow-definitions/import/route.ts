import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { resolveMetaTemplatesClient } from "@/lib/meta-whatsapp/resolve-templates-client";
import {
  getFlowDefinitionById,
  importFlowFromMeta,
} from "@/services/whatsapp-flow-definitions";

function requireAdminOrManager(session: { user?: { role?: string } }): NextResponse | null {
  const r = session.user?.role;
  if (r !== "ADMIN" && r !== "MANAGER") {
    return NextResponse.json({ message: "Apenas administrador ou gestor." }, { status: 403 });
  }
  return null;
}

export async function POST(request: Request) {
  return withOrgContext(async (session) => {
    const denied = requireAdminOrManager(session);
    if (denied) return denied;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const metaFlowId =
      body && typeof body === "object" && typeof (body as Record<string, unknown>).metaFlowId === "string"
        ? (body as Record<string, unknown>).metaFlowId.trim()
        : "";
    if (!metaFlowId) {
      return NextResponse.json({ message: "metaFlowId é obrigatório." }, { status: 400 });
    }

    const resolved = await resolveMetaTemplatesClient({
      organizationId: session.user.organizationId,
      isSuperAdmin: session.user.isSuperAdmin,
    });
    if (!resolved.ok) return resolved.response;

    try {
      const result = await importFlowFromMeta(
        session.user.organizationId!,
        metaFlowId,
        resolved.client,
      );
      const row = await getFlowDefinitionById(result.id);
      return NextResponse.json({
        id: result.id,
        created: result.created,
        flow: row,
      });
    } catch (e) {
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro ao importar flow." },
        { status: 400 },
      );
    }
  });
}
