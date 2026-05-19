import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { listLeadMappingFields } from "@/services/whatsapp-flow-definitions";

function requireAdminOrManager(session: { user?: { role?: string } }): NextResponse | null {
  const r = session.user?.role;
  if (r !== "ADMIN" && r !== "MANAGER") {
    return NextResponse.json({ message: "Apenas administrador ou gestor." }, { status: 403 });
  }
  return null;
}

/** Campos do negócio (deal) para mapeamento de respostas do Flow. */
export async function GET() {
  return withOrgContext(async (session) => {
    const denied = requireAdminOrManager(session);
    if (denied) return denied;
    try {
      const data = await listLeadMappingFields();
      return NextResponse.json(data);
    } catch (e) {
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro." },
        { status: 500 },
      );
    }
  });
}
