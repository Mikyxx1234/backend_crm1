import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { deleteTemplate, getTemplateById, updateTemplate } from "@/services/templates";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    const { id } = await ctx.params;
    const template = await getTemplateById(id);
    if (!template) return NextResponse.json({ message: "Template não encontrado." }, { status: 404 });
    return NextResponse.json(template);
  } catch (e) {
    return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
  }
}

export async function PUT(request: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    const { id } = await ctx.params;
    const body = (await request.json()) as Record<string, unknown>;
    const template = await updateTemplate(id, {
      name: typeof body.name === "string" ? body.name.trim() : undefined,
      content: typeof body.content === "string" ? body.content.trim() : undefined,
      category: typeof body.category === "string" ? body.category.trim() || undefined : undefined,
      language: typeof body.language === "string" ? body.language.trim() || undefined : undefined,
      status: typeof body.status === "string" ? (body.status as Parameters<typeof updateTemplate>[1]["status"]) : undefined,
      channelType: body.channelType === null ? null : typeof body.channelType === "string" ? (body.channelType as Parameters<typeof updateTemplate>[1]["channelType"]) : undefined,
    });
    return NextResponse.json(template);
  } catch (e) {
    return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    const { id } = await ctx.params;
    await deleteTemplate(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
  }
}
