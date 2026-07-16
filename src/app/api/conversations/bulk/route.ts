import { NextResponse } from "next/server";

import type { Prisma } from "@prisma/client";

import { auth } from "@/lib/auth";
import { getVisibilityFilter } from "@/lib/visibility";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/services/activity-log";

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

    const logBulkStatus = async (
      changedIds: string[],
      from: string,
      to: string,
      type: "CONVERSATION_CLOSED" | "CONVERSATION_REOPENED",
    ) => {
      const convs = await prisma.conversation.findMany({
        where: { id: { in: changedIds } },
        select: { id: true, contactId: true, contact: { select: { name: true } } },
      });
      await Promise.all(
        convs.map((c) =>
          logEvent({
            type,
            entityType: "CONVERSATION",
            entityId: c.id,
            entityLabel: c.contact?.name ?? null,
            conversationId: c.id,
            contactId: c.contactId,
            field: "status",
            oldValue: from,
            newValue: to,
            meta: { from, to, source: "bulk" },
          }),
        ),
      );
    };

    switch (action) {
      case "resolve": {
        const toChange = await prisma.conversation.findMany({
          where: scopedWhere(ids, { status: { not: "RESOLVED" } }),
          select: { id: true },
        });
        const result = await prisma.conversation.updateMany({
          where: scopedWhere(ids, { status: { not: "RESOLVED" } }),
          data: { status: "RESOLVED" },
        });
        void logBulkStatus(
          toChange.map((c) => c.id),
          "OPEN",
          "RESOLVED",
          "CONVERSATION_CLOSED",
        );
        return NextResponse.json({ updated: result.count });
      }
      case "reopen": {
        const toChange = await prisma.conversation.findMany({
          where: scopedWhere(ids, { status: "RESOLVED" }),
          select: { id: true },
        });
        const result = await prisma.conversation.updateMany({
          where: scopedWhere(ids, { status: "RESOLVED" }),
          data: { status: "OPEN" },
        });
        void logBulkStatus(
          toChange.map((c) => c.id),
          "RESOLVED",
          "OPEN",
          "CONVERSATION_REOPENED",
        );
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
