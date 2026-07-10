import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: Request, ctx: Ctx) {
  try {
    const session = await auth();
    const user = session?.user as { id?: string; organizationId?: string | null } | undefined;
    if (!user?.id || !user.organizationId) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { id } = await ctx.params;
    const body = (await request.json()) as Record<string, unknown>;

    const data: Record<string, unknown> = {};
    if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
    if (typeof body.content === "string" && body.content.trim()) data.content = body.content.trim();
    if (typeof body.position === "number") data.position = body.position;
    if ("groupId" in body) data.groupId = body.groupId ?? null;
    if ("attachmentUrl" in body) data.attachmentUrl = body.attachmentUrl ?? null;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ message: "Nenhum campo para atualizar." }, { status: 400 });
    }

    const updated = await prisma.quickReply.update({
      where: { id, organizationId: user.organizationId },
      data,
      include: { group: { select: { id: true, name: true } } },
    });
    return NextResponse.json(updated);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao atualizar resposta rápida." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await auth();
    const user = session?.user as { id?: string; organizationId?: string | null } | undefined;
    if (!user?.id || !user.organizationId) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { id } = await ctx.params;
    await prisma.quickReply.delete({
      where: { id, organizationId: user.organizationId },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao excluir resposta rápida." }, { status: 500 });
  }
}
