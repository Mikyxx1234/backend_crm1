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
    const ref: string | null =
      typeof body?.messageId === "string" ? body.messageId : null;

    // Persistimos SEMPRE o id INTERNO (cuid), não o `externalId` (wamid)
    // que o frontend usa como chave de bolha (`InboxMessageDto.id =
    // externalId ?? id`, vide GET /messages). Sem resolver aqui, o
    // `findFirst` batia em zero linhas pra qualquer mensagem recebida
    // (que sempre tem `externalId`) e a rota devolvia 404.
    let internalId: string | null = null;
    if (ref) {
      const msg = await prisma.message.findFirst({
        where: {
          conversationId: id,
          OR: [{ id: ref }, { externalId: ref }],
        },
        select: { id: true },
      });
      if (!msg) {
        return NextResponse.json(
          { message: "Mensagem não encontrada nesta conversa." },
          { status: 404 },
        );
      }
      internalId = msg.id;
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: { pinnedMessageId: internalId },
      select: { id: true, pinnedMessageId: true },
    });

    return NextResponse.json(updated);
  });
}
