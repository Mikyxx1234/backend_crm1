import { NextResponse } from "next/server";

import type { Prisma } from "@prisma/client";

import { auth } from "@/lib/auth";
import { getVisibilityFilter } from "@/lib/visibility";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const user = session.user as { id: string; role: "ADMIN" | "MANAGER" | "MEMBER" };
    const { conversationWhere } = await getVisibilityFilter(user);
    const scopedWhere = (ids: string[], extra: Prisma.ConversationWhereInput) => {
      const idIn: Prisma.ConversationWhereInput = { id: { in: ids } };
      if (!conversationWhere || Object.keys(conversationWhere).length === 0) {
        return { AND: [idIn, extra] };
      }
      return { AND: [idIn, conversationWhere, extra] };
    };

    const body = (await request.json()) as { ids?: string[]; action?: string };
    const { ids, action } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ message: "Nenhuma conversa selecionada." }, { status: 400 });
    }
    if (ids.length > 200) {
      return NextResponse.json({ message: "Máximo 200 conversas por vez." }, { status: 400 });
    }

    switch (action) {
      case "resolve": {
        const result = await prisma.conversation.updateMany({
          where: scopedWhere(ids, { status: { not: "RESOLVED" } }),
          data: { status: "RESOLVED" },
        });
        return NextResponse.json({ updated: result.count });
      }
      case "reopen": {
        const result = await prisma.conversation.updateMany({
          where: scopedWhere(ids, { status: "RESOLVED" }),
          data: { status: "OPEN" },
        });
        return NextResponse.json({ updated: result.count });
      }
      default:
        return NextResponse.json({ message: `Ação desconhecida: ${action}` }, { status: 400 });
    }
  } catch (e) {
    console.error("[bulk]", e);
    return NextResponse.json({ message: "Erro ao executar ação em massa." }, { status: 500 });
  }
}
