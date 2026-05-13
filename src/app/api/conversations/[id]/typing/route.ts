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

    if (!metaWhatsApp.configured) {
      return NextResponse.json({ ok: false });
    }

    const { id } = await context.params;
    const denied = await requireConversationAccess(session, id);
    if (denied) return denied;

    const lastInbound = await prisma.message.findFirst({
      where: { conversationId: id, direction: "in", externalId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { externalId: true },
    });

    if (!lastInbound?.externalId) {
      return NextResponse.json({ ok: false });
    }

    await metaWhatsApp.sendTypingIndicator(lastInbound.externalId);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.warn("[typing] error:", e);
    return NextResponse.json({ ok: false });
  }
}
