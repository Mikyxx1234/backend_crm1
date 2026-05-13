import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requireConversationAccess } from "@/lib/conversation-access";
import { prisma } from "@/lib/prisma";
import { metaWhatsApp } from "@/lib/meta-whatsapp/client";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { id } = await context.params;
    const denied = await requireConversationAccess(session, id);
    if (denied) return denied;

    await prisma.conversation.update({
      where: { id },
      data: { unreadCount: 0, lastReadAt: new Date() },
    });

    if (metaWhatsApp.configured) {
      const lastInbound = await prisma.message.findFirst({
        where: { conversationId: id, direction: "in", externalId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { externalId: true },
      });

      if (lastInbound?.externalId) {
        metaWhatsApp.markAsRead(lastInbound.externalId).catch((err) =>
          console.warn("[read] markAsRead failed:", err instanceof Error ? err.message : err)
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao marcar como lido." }, { status: 500 });
  }
}
