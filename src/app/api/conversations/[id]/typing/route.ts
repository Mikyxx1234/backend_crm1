import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requireConversationAccess } from "@/lib/conversation-access";
import { prisma } from "@/lib/prisma";
import { metaClientFromConfig } from "@/lib/meta-whatsapp/client";

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

    // CRITICO: typing indicator tem que sair pelo canal da conversa
    // (token/phoneId desse tenant). Sem isso, "digitando..." aparecia no
    // numero da Eduit (singleton global do env) mesmo quando o operador
    // estava digitando numa conversa da DNA.
    const conv = await prisma.conversation.findUnique({
      where: { id },
      select: {
        channelRef: { select: { id: true, config: true } },
      },
    });
    const channelConfig = conv?.channelRef?.config as
      | Record<string, unknown>
      | null
      | undefined;
    const metaClient = metaClientFromConfig(channelConfig);

    if (!metaClient.configured) {
      return NextResponse.json({ ok: false });
    }

    const lastInbound = await prisma.message.findFirst({
      where: { conversationId: id, direction: "in", externalId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { externalId: true },
    });

    if (!lastInbound?.externalId) {
      return NextResponse.json({ ok: false });
    }

    await metaClient.sendTypingIndicator(lastInbound.externalId);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.warn("[typing] error:", e);
    return NextResponse.json({ ok: false });
  }
}
