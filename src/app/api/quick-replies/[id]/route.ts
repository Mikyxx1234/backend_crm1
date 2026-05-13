import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { deleteQuickReply, updateQuickReply } from "@/services/quick-replies";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    const { id } = await ctx.params;
    const body = (await request.json()) as Record<string, unknown>;
    const reply = await updateQuickReply(id, {
      title: typeof body.title === "string" ? body.title.trim() : undefined,
      content: typeof body.content === "string" ? body.content.trim() : undefined,
      category: typeof body.category === "string" ? body.category.trim() || undefined : undefined,
      position: typeof body.position === "number" ? body.position : undefined,
    });
    return NextResponse.json(reply);
  } catch (e) {
    return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    const { id } = await ctx.params;
    await deleteQuickReply(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
  }
}
