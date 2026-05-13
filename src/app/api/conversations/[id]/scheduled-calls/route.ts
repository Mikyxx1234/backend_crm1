import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requireConversationAccess } from "@/lib/conversation-access";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });

  const { id: conversationId } = await ctx.params;
  const denied = await requireConversationAccess(session, conversationId);
  if (denied) return denied;

  const items = await prisma.scheduledWhatsappCall.findMany({
    where: { conversationId },
    orderBy: { scheduledAt: "asc" },
    take: 50,
    include: {
      assignee: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({
    items: items.map((r) => ({
      id: r.id,
      scheduledAt: r.scheduledAt.toISOString(),
      status: r.status,
      notes: r.notes,
      sourceMetaCallId: r.sourceMetaCallId,
      assignee: r.assignee,
    })),
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });

  const { id: conversationId } = await ctx.params;
  const denied = await requireConversationAccess(session, conversationId);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }

  const scheduledAtRaw = typeof body.scheduledAt === "string" ? body.scheduledAt : "";
  const scheduledAt = new Date(scheduledAtRaw);
  if (Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ message: "scheduledAt inválido (use ISO 8601)." }, { status: 400 });
  }

  const assigneeUserId =
    typeof body.assigneeUserId === "string" && body.assigneeUserId.trim()
      ? body.assigneeUserId.trim()
      : null;
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  const sourceMetaCallId =
    typeof body.sourceMetaCallId === "string" ? body.sourceMetaCallId.trim() || null : null;

  if (assigneeUserId) {
    const u = await prisma.user.findUnique({ where: { id: assigneeUserId }, select: { id: true } });
    if (!u) return NextResponse.json({ message: "Agente não encontrado." }, { status: 400 });
  }

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { contactId: true },
  });
  if (!conv) return NextResponse.json({ message: "Conversa não encontrada." }, { status: 404 });

  const row = await prisma.scheduledWhatsappCall.create({
    data: {
      conversationId,
      contactId: conv.contactId,
      scheduledAt,
      assigneeUserId,
      notes,
      sourceMetaCallId,
    },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json(
    {
      item: {
        id: row.id,
        scheduledAt: row.scheduledAt.toISOString(),
        status: row.status,
        notes: row.notes,
        sourceMetaCallId: row.sourceMetaCallId,
        assignee: row.assignee,
      },
    },
    { status: 201 }
  );
}
