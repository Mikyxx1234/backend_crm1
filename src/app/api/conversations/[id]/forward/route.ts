import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getContactWhatsAppTargets } from "@/lib/contact-whatsapp-target";
import { requireConversationAccess } from "@/lib/conversation-access";
import { prisma } from "@/lib/prisma";
import { metaWhatsApp, formatMetaSendError } from "@/lib/meta-whatsapp/client";
import { getConversationLite } from "@/services/conversations";
import { fireTrigger } from "@/services/automation-triggers";
import { cancelPendingForConversation } from "@/services/scheduled-messages";

type RouteContext = { params: Promise<{ id: string }> };

function buildForwardBody(params: {
  senderLabel: string;
  content: string;
  hasMedia: boolean;
}): string {
  const lines = [
    "📤 *Encaminhado*",
    "",
    `De: ${params.senderLabel}`,
    "──────────",
    params.content.trim() || "[Sem texto]",
  ];
  if (params.hasMedia) lines.push("", "_(Havia mídia na mensagem original — veja na conversa de origem.)_");
  const body = lines.join("\n");
  if (body.length > 4000) return `${body.slice(0, 3997)}…`;
  return body;
}

/**
 * Encaminha o texto de uma mensagem da conversa de origem para o contato da conversa alvo (WhatsApp).
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { id: targetConversationId } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const b = body as Record<string, unknown>;
    const sourceConversationId =
      typeof b.sourceConversationId === "string" ? b.sourceConversationId.trim() : "";
    const messageRef = typeof b.messageRef === "string" ? b.messageRef.trim() : "";

    if (!sourceConversationId || !messageRef) {
      return NextResponse.json(
        { message: "sourceConversationId e messageRef são obrigatórios." },
        { status: 400 }
      );
    }

    if (sourceConversationId === targetConversationId) {
      return NextResponse.json(
        { message: "Escolha outra conversa para encaminhar." },
        { status: 400 }
      );
    }

    const deniedTarget = await requireConversationAccess(session, targetConversationId);
    if (deniedTarget) return deniedTarget;
    const deniedSource = await requireConversationAccess(session, sourceConversationId);
    if (deniedSource) return deniedSource;

    const targetConv = await getConversationLite(targetConversationId);
    const sourceConv = await getConversationLite(sourceConversationId);
    if (!targetConv || !sourceConv) {
      return NextResponse.json({ message: "Conversa não encontrada." }, { status: 404 });
    }

    const sourceMsg = await prisma.message.findFirst({
      where: {
        conversationId: sourceConversationId,
        OR: [{ id: messageRef }, { externalId: messageRef }],
        isPrivate: false,
        direction: { not: "system" },
      },
      select: {
        id: true,
        content: true,
        senderName: true,
        direction: true,
        mediaUrl: true,
        messageType: true,
      },
    });

    if (!sourceMsg) {
      return NextResponse.json({ message: "Mensagem não encontrada ou não pode ser encaminhada." }, { status: 404 });
    }

    const senderLabel =
      sourceMsg.direction === "in"
        ? (sourceMsg.senderName?.trim() || "Cliente")
        : (sourceMsg.senderName?.trim() || "Equipe");

    const hasMedia = Boolean(sourceMsg.mediaUrl?.trim());
    const content = buildForwardBody({
      senderLabel,
      content: sourceMsg.content,
      hasMedia,
    });

    if (!metaWhatsApp.configured) {
      return NextResponse.json(
        { message: "Meta WhatsApp API não configurada." },
        { status: 503 }
      );
    }

    const waTarget = await getContactWhatsAppTargets(targetConv.contactId);
    if (!waTarget) {
      return NextResponse.json(
        { message: "Contato de destino sem telefone nem BSUID WhatsApp." },
        { status: 400 }
      );
    }

    const senderName = session.user.name ?? session.user.email ?? "Agente";

    const saved = await prisma.message.create({
      data: {
        conversationId: targetConversationId,
        content,
        direction: "out",
        messageType: "text",
        senderName,
      },
    });

    let externalId: string | null = null;
    let sendErrorMsg: string | null = null;
    try {
      const result = await metaWhatsApp.sendText(waTarget.to, content, waTarget.recipient);
      externalId = result.messages?.[0]?.id ?? null;
      if (externalId) {
        await prisma.message.update({
          where: { id: saved.id },
          data: { externalId },
        });
      }
    } catch (sendErr) {
      sendErrorMsg = formatMetaSendError(sendErr);
      await prisma.message.update({
        where: { id: saved.id },
        data: { sendStatus: "failed", sendError: sendErrorMsg },
      }).catch(() => {});
    }

    try {
      await prisma.conversation.update({
        where: { id: targetConversationId },
        data: {
          lastMessageDirection: "out",
          hasAgentReply: true,
          ...(sendErrorMsg ? { hasError: true } : { hasError: false }),
        },
      });
    } catch {
      /* optional columns */
    }

    fireTrigger("message_sent", {
      contactId: targetConv.contactId,
      data: { channel: "WhatsApp", content: "[encaminhado]" },
    }).catch(() => {});

    cancelPendingForConversation(targetConversationId, "agent_reply").catch(
      (err) =>
        console.warn(
          "[scheduled-messages] falha ao cancelar apos encaminhamento:",
          err,
        ),
    );

    return NextResponse.json(
      {
        message: {
          id: externalId ?? saved.id,
          content,
          createdAt: saved.createdAt.toISOString(),
          direction: "out",
          messageType: "text",
          senderName,
        },
        ...(sendErrorMsg ? { metaError: sendErrorMsg } : {}),
      },
      { status: 201 }
    );
  } catch (e: unknown) {
    console.error(e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Erro ao encaminhar." },
      { status: 500 }
    );
  }
}
