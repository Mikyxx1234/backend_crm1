import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { requireConversationAccess } from "@/lib/conversation-access";
import { prisma } from "@/lib/prisma";
import { metaClientFromConfig } from "@/lib/meta-whatsapp/client";

type RouteContext = { params: Promise<{ id: string }> };

// Bug 27/abr/26: usavamos `auth()` direto. O update de
// conversation.unreadCount/lastReadAt e o lookup de message por externalId
// passam pela Prisma extension multi-tenant que exige RequestContext.
// Migrado para withOrgContext.
export async function POST(_request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    try {
      const { id } = await context.params;
      const denied = await requireConversationAccess(session, id);
      if (denied) return denied;

      await prisma.conversation.update({
        where: { id },
        data: { unreadCount: 0, lastReadAt: new Date() },
      });

      // markAsRead na API da Meta tem que ir pelo canal da conversa
      // (token/phoneId desse cliente), nao pelo singleton global do env.
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

      if (metaClient.configured) {
        const lastInbound = await prisma.message.findFirst({
          where: { conversationId: id, direction: "in", externalId: { not: null } },
          orderBy: { createdAt: "desc" },
          select: { externalId: true },
        });

        if (lastInbound?.externalId) {
          metaClient.markAsRead(lastInbound.externalId).catch((err) =>
            console.warn("[read] markAsRead failed:", err instanceof Error ? err.message : err)
          );
        }
      }

      return NextResponse.json({ ok: true });
    } catch (e) {
      console.error(e);
      return NextResponse.json({ message: "Erro ao marcar como lido." }, { status: 500 });
    }
  });
}
