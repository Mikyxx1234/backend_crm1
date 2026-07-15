import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { requireConversationAccess } from "@/lib/conversation-access";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/conversations/:id/pin-message
 *
 * Banner de mensagem fixada no topo da conversa (estilo WhatsApp).
 * Body: `{ messageId: string | null }`. `null` desafixa.
 *
 * Diferente de `pin-note` (exclusivo pra notas internas, aba "Notas"):
 * aqui QUALQUER mensagem da conversa pode ser fixada. Slot único —
 * fixar uma nova substitui a anterior automaticamente.
 */
export async function PUT(req: Request, ctx: Ctx) {
  return withOrgContext(async (session) => {
    const { id } = await ctx.params;
    const denied = await requireConversationAccess(session, id);
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));
    const messageId: string | null =
      typeof body?.messageId === "string" ? body.messageId : null;

    if (messageId) {
      const msg = await prisma.message.findFirst({
        where: { id: messageId, conversationId: id },
        select: { id: true },
      });
      if (!msg) {
        return NextResponse.json(
          { message: "Mensagem não encontrada nesta conversa." },
          { status: 404 },
        );
      }
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: { pinnedMessageId: messageId },
      select: { id: true, pinnedMessageId: true },
    });

    return NextResponse.json(updated);
  });
}
