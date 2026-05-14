import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getContactWhatsAppTargets } from "@/lib/contact-whatsapp-target";
import { requireConversationAccess } from "@/lib/conversation-access";
import { prisma } from "@/lib/prisma";
import { metaClientFromConfig } from "@/lib/meta-whatsapp/client";

type Ctx = { params: Promise<{ id: string }> };

type Reaction = { emoji: string; senderName: string };

export async function POST(request: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { id: ref } = await ctx.params;
    const body = (await request.json()) as Record<string, unknown>;
    const emoji = typeof body.emoji === "string" ? body.emoji.trim() : "";

    if (!emoji) {
      return NextResponse.json({ message: "Emoji obrigatório." }, { status: 400 });
    }

    const message = await prisma.message.findFirst({
      where: {
        OR: [{ id: ref }, { externalId: ref }],
      },
      select: {
        id: true,
        reactions: true,
        conversationId: true,
        direction: true,
        externalId: true,
        conversation: {
          select: {
            contactId: true,
            channelRef: { select: { config: true, provider: true } },
          },
        },
      },
    });

    if (!message) {
      return NextResponse.json({ message: "Mensagem não encontrada." }, { status: 404 });
    }

    const gate = await requireConversationAccess(session, message.conversationId);
    if (gate) return gate;

    const senderName = session.user.name ?? session.user.email ?? "Agente";
    const current = (Array.isArray(message.reactions) ? message.reactions : []) as Reaction[];

    const existingIdx = current.findIndex(
      (r) => r.senderName === senderName && r.emoji === emoji
    );

    let updated: Reaction[];
    let metaEmoji: string;
    if (existingIdx >= 0) {
      updated = current.filter((_, i) => i !== existingIdx);
      metaEmoji = "";
    } else {
      const withoutSameEmoji = current.filter(
        (r) => !(r.senderName === senderName)
      );
      updated = [...withoutSameEmoji, { emoji, senderName }];
      metaEmoji = emoji;
    }

    await prisma.message.update({
      where: { id: message.id },
      data: { reactions: updated },
    });

    if (
      message.direction === "in" &&
      message.externalId &&
      message.conversation?.contactId &&
      message.conversation?.channelRef?.provider === "META_CLOUD_API"
    ) {
      const channelConfig = message.conversation.channelRef.config as
        | Record<string, unknown>
        | null
        | undefined;
      const metaClient = metaClientFromConfig(channelConfig);
      if (metaClient.configured) {
        const targets = await getContactWhatsAppTargets(message.conversation.contactId);
        if (targets) {
          metaClient
            .sendReaction(targets.to, message.externalId, metaEmoji, targets.recipient)
            .catch((e) =>
              console.warn("[meta-reaction]", e instanceof Error ? e.message : e)
            );
        }
      }
    }

    return NextResponse.json({ reactions: updated });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Erro." },
      { status: 500 }
    );
  }
}
