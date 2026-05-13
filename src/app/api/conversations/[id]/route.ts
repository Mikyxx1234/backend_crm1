import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requireConversationAccess } from "@/lib/conversation-access";
import { getConversationById } from "@/services/conversations";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { id } = await context.params;
    const denied = await requireConversationAccess(session, id);
    if (denied) return denied;

    const row = await getConversationById(id);
    if (!row) {
      return NextResponse.json({ message: "Conversa não encontrada." }, { status: 404 });
    }

    return NextResponse.json(row);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao carregar conversa." }, { status: 500 });
  }
}
