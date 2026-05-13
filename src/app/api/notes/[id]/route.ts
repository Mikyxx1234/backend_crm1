import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createDealEvent } from "@/services/deals";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });

    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ message: "ID inválido." }, { status: 400 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const b = (body ?? {}) as Record<string, unknown>;
    const content = typeof b.content === "string" ? b.content.trim() : "";
    if (!content) return NextResponse.json({ message: "Conteúdo obrigatório." }, { status: 400 });

    const existing = await prisma.note.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ message: "Nota não encontrada." }, { status: 404 });

    const note = await prisma.note.update({
      where: { id },
      data: { content },
      include: { user: { select: { id: true, name: true } } },
    });

    if (existing.dealId && existing.content !== content) {
      const uid = session.user.id as string;
      createDealEvent(existing.dealId, uid, "NOTE_UPDATED", {
        preview: content.slice(0, 100),
      }).catch(() => {});
    }

    return NextResponse.json(note);
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Erro ao atualizar nota." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });

    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ message: "ID inválido." }, { status: 400 });

    const existing = await prisma.note.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ message: "Nota não encontrada." }, { status: 404 });

    await prisma.note.delete({ where: { id } });

    if (existing.dealId) {
      const uid = session.user.id as string;
      createDealEvent(existing.dealId, uid, "NOTE_DELETED", {
        preview: existing.content.slice(0, 100),
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Erro ao excluir nota." },
      { status: 500 },
    );
  }
}
