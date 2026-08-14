import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { requireConversationAccess } from "@/lib/conversation-access";
import { getConversationById } from "@/services/conversations";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    try {
      const { id } = await context.params;
      const row = await getConversationById(id);
      if (!row) {
        return NextResponse.json({ message: "Conversa não encontrada." }, { status: 404 });
      }
      const denied = await requireConversationAccess(session, row.id);
      if (denied) return denied;

      return NextResponse.json(row);
    } catch (e) {
      console.error(e);
      return NextResponse.json({ message: "Erro ao carregar conversa." }, { status: 500 });
    }
  });
}
