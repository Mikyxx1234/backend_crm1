import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { requireConversationAccess } from "@/lib/conversation-access";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

/** Prazos aceitos pelo picker (estilo WhatsApp: 24h / 7 dias / 30 dias). */
const DURATION_HOURS = new Set([24, 24 * 7, 24 * 30]);

/**
 * PUT /api/conversations/:id/pin-message
 *
 * Banner de mensagem fixada no topo da conversa (estilo WhatsApp).
 * Body: `{ messageId: string | null, durationHours?: number }`.
 * `messageId: null` desafixa. `durationHours` ausente = sem prazo
 * (fixado até desafixar manualmente); valores aceitos: 24, 168, 720.
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
    const durationHours: number | null =
      typeof body?.durationHours === "number" && DURATION_HOURS.has(body.durationHours)
        ? body.durationHours
        : null;

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
      data: {
        pinnedMessageId: internalId,
        pinnedMessageExpiresAt:
          internalId && durationHours
            ? new Date(Date.now() + durationHours * 60 * 60 * 1000)
            : null,
      },
      select: { id: true, pinnedMessageId: true, pinnedMessageExpiresAt: true },
    });

    return NextResponse.json(updated);
  });
}
