import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { getOrgIdOrThrow } from "@/lib/request-context";
import {
  createFlowDefinitionDraft,
  listFlowDefinitions,
  type FlowDefinitionUpsertInput,
} from "@/services/whatsapp-flow-definitions";

function requireAdminOrManager(session: { user?: { role?: string } }): NextResponse | null {
  const r = session.user?.role;
  if (r !== "ADMIN" && r !== "MANAGER") {
    return NextResponse.json({ message: "Apenas administrador ou gestor." }, { status: 403 });
  }
  return null;
}

export async function GET() {
  return withOrgContext(async (session) => {
    const denied = requireAdminOrManager(session);
    if (denied) return denied;
    try {
      const items = await listFlowDefinitions();
      return NextResponse.json(items);
    } catch (e) {
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro." },
        { status: 500 },
      );
    }
  });
}

export async function POST(request: Request) {
  return withOrgContext(async (session) => {
    const denied = requireAdminOrManager(session);
    if (denied) return denied;
    try {
      const body = (await request.json()) as FlowDefinitionUpsertInput;
      const orgId = getOrgIdOrThrow();
      const { id } = await createFlowDefinitionDraft(orgId, body);
      return NextResponse.json({ id }, { status: 201 });
    } catch (e) {
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro." },
        { status: 400 },
      );
    }
  });
}
