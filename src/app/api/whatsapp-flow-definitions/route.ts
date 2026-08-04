import { NextResponse } from "next/server";

import { withApiAuthContext } from "@/lib/api-auth";
import { withOrgContext } from "@/lib/auth-helpers";
import { getOrgIdOrThrow } from "@/lib/request-context";
import {
  createFlowDefinitionDraft,
  listFlowDefinitions,
  type FlowDefinitionUpsertInput,
} from "@/services/whatsapp-flow-definitions";

function requireAdminOrManager(session: { user?: { role?: string } }): NextResponse | null {
  return requireAdminOrManagerRole(session.user?.role);
}

function requireAdminOrManagerRole(role: string | undefined): NextResponse | null {
  if (role !== "ADMIN" && role !== "MANAGER") {
    return NextResponse.json({ message: "Apenas administrador ou gestor." }, { status: 403 });
  }
  return null;
}

// Auth hibrida (Bearer OU sessao) no GET: o node do n8n lista os flows para
// o operador escolher qual anexar ao template. A exigencia de ADMIN/MANAGER
// continua valendo — via Bearer ela recai sobre o usuario dono do token.
export async function GET(request: Request) {
  return withApiAuthContext(request, async (user) => {
    const denied = requireAdminOrManagerRole(user.role);
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
