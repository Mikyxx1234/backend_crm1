import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { resolveMetaTemplatesClient } from "@/lib/meta-whatsapp/resolve-templates-client";
import {
  deleteFlowDefinitionDraft,
  getFlowDefinitionById,
  replaceFlowDefinitionDraft,
  type FlowDefinitionUpsertInput,
} from "@/services/whatsapp-flow-definitions";

function requireAdminOrManager(session: { user?: { role?: string } }): NextResponse | null {
  const r = session.user?.role;
  if (r !== "ADMIN" && r !== "MANAGER") {
    return NextResponse.json({ message: "Apenas administrador ou gestor." }, { status: 403 });
  }
  return null;
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    const denied = requireAdminOrManager(session);
    if (denied) return denied;
    const { id } = await context.params;
    if (!id) return NextResponse.json({ message: "ID inválido." }, { status: 400 });
    const row = await getFlowDefinitionById(id);
    if (!row) return NextResponse.json({ message: "Não encontrado." }, { status: 404 });
    return NextResponse.json(row);
  });
}

export async function PUT(request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    const denied = requireAdminOrManager(session);
    if (denied) return denied;
    const { id } = await context.params;
    if (!id) return NextResponse.json({ message: "ID inválido." }, { status: 400 });
    try {
      const body = (await request.json()) as FlowDefinitionUpsertInput;
      await replaceFlowDefinitionDraft(id, body);
      const row = await getFlowDefinitionById(id);
      return NextResponse.json(row);
    } catch (e) {
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro." },
        { status: 400 },
      );
    }
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
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
      await deleteFlowDefinitionDraft(id, resolved.client);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro." },
        { status: 400 },
      );
    }
  });
}
