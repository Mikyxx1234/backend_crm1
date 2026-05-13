import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { metaWhatsApp } from "@/lib/meta-whatsapp/client";
import { prisma } from "@/lib/prisma";
import { sseBus } from "@/lib/sse-bus";

/**
 * Aprova um rascunho da IA. O operador pode editar o texto antes de
 * aprovar (via `body.content`). O rascunho vira mensagem "real" (não
 * privada) e é enviado pro cliente via WhatsApp.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }
  const { messageId } = await params;

  const body = (await request.json().catch(() => ({}))) as {
    content?: string;
  };

  const draft = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      conversation: { select: { id: true, contactId: true } },
    },
  });
  if (!draft || draft.messageType !== "ai_draft" || !draft.isPrivate) {
    return NextResponse.json(
      { message: "Rascunho não encontrado." },
      { status: 404 },
    );
  }

  const content = (body.content ?? draft.content).trim();
  if (!content) {
    return NextResponse.json(
      { message: "Conteúdo vazio." },
      { status: 400 },
    );
  }

  if (!metaWhatsApp.configured) {
    return NextResponse.json(
      { message: "Meta WhatsApp não configurado." },
      { status: 500 },
    );
  }
  const contact = draft.conversation.contactId
    ? await prisma.contact.findUnique({
        where: { id: draft.conversation.contactId },
        select: { phone: true },
      })
    : null;
  if (!contact?.phone) {
    return NextResponse.json(
      { message: "Contato sem telefone." },
      { status: 400 },
    );
  }

  let externalId: string | null = null;
  try {
    const send = await metaWhatsApp.sendText(contact.phone, content);
    externalId = send.messages?.[0]?.id ?? null;
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Falha no envio." },
      { status: 502 },
    );
  }

  const approved = await prisma.message.update({
    where: { id: messageId },
    data: {
      content,
      messageType: "text",
      isPrivate: false,
      externalId,
      sendStatus: "sent",
      senderName: "Agente IA",
    },
  });
  await prisma.conversation
    .update({
      where: { id: draft.conversation.id },
      data: {
        lastMessageDirection: "out",
        hasAgentReply: true,
        updatedAt: new Date(),
      },
    })
    .catch(() => null);
  sseBus.publish("message_updated", {
    conversationId: draft.conversation.id,
    messageId,
    status: "approved",
  });
  return NextResponse.json(approved);
}
