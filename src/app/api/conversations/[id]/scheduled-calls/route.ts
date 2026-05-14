import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { requireConversationAccess } from "@/lib/conversation-access";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

type Ctx = { params: Promise<{ id: string }> };

// Bug 27/abr/26: usavamos `auth()` direto. A rota chama `withOrgFromCtx`
// (direto ou via service), avaliado ANTES da Prisma extension popular
// o ctx. Migrado para withOrgContext.
export async function GET(_req: Request, ctx: Ctx) {
  return withOrgContext(async (session) => {
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
  });
}

export async function POST(req: Request, ctx: Ctx) {
  return withOrgContext(async (session) => {
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

    // Cria e relê com include — o extension scoped tem inferencia limitada
    // no `include` direto do `.create`, entao buscamos via findUniqueOrThrow
    // logo apos para preservar o tipo correto.
    const created = await prisma.scheduledWhatsappCall.create({
      data: withOrgFromCtx({
        conversationId,
        contactId: conv.contactId,
        scheduledAt,
        assigneeUserId,
        notes,
        sourceMetaCallId,
      }),
      select: { id: true },
    });
    const row = await prisma.scheduledWhatsappCall.findUniqueOrThrow({
      where: { id: created.id },
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
  });
}
