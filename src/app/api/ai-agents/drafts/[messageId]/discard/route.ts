import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sseBus } from "@/lib/sse-bus";

/**
 * Descarta um rascunho da IA. Hard-delete: a mensagem some do
 * histórico do operador. Se o usuário quiser reter decisões, basta
 * não descartar (rascunho fica visível com status "draft" até ser
 * aprovado ou expirar manualmente).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }
  const { messageId } = await params;

  const draft = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, messageType: true, isPrivate: true, conversationId: true },
  });
  if (!draft || draft.messageType !== "ai_draft" || !draft.isPrivate) {
    return NextResponse.json(
      { message: "Rascunho não encontrado." },
      { status: 404 },
    );
  }
  await prisma.message.delete({ where: { id: messageId } });
  sseBus.publish("message_deleted", {
    conversationId: draft.conversationId,
    messageId,
  });
  return NextResponse.json({ ok: true });
}
