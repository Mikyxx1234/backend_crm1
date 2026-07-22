import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { getSupportDepartment } from "@/services/support/distribution";
import { isSupportAgent, type SupportViewer } from "@/services/support/tickets";

/**
 * Metadados do chat de suporte para o cliente decidir o que renderizar:
 * se o suporte está configurado (há departamento marcado como isSupport)
 * e se o usuário atual é um agente de suporte (vê o console).
 */
export async function GET() {
  return withOrgContext(async (session) => {
    const viewer: SupportViewer = {
      userId: session.user.id,
      organizationId: session.user.organizationId!,
      role: session.user.role ?? null,
    };
    const dept = await getSupportDepartment(viewer.organizationId);
    const agent = await isSupportAgent(viewer);
    return NextResponse.json({
      supportConfigured: !!dept,
      department: dept,
      isAgent: agent,
    });
  });
}
