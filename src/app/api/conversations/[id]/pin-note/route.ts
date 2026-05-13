import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireConversationAccess } from "@/lib/conversation-access";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });

  const { id } = await ctx.params;
  const denied = await requireConversationAccess(session, id);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const noteId: string | null = body.noteId ?? null;

  if (noteId) {
    const msg = await prisma.message.findFirst({
      where: { id: noteId, conversationId: id, isPrivate: true },
    });
    if (!msg) {
      return NextResponse.json({ message: "Nota não encontrada nesta conversa." }, { status: 404 });
    }
  }

  const updated = await prisma.conversation.update({
    where: { id },
    data: { pinnedNoteId: noteId },
    select: { id: true, pinnedNoteId: true },
  });

  return NextResponse.json(updated);
}
