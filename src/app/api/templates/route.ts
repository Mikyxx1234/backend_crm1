import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { createTemplate, getTemplates } from "@/services/templates";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    const templates = await getTemplates();
    return NextResponse.json(templates);
  } catch (e) {
    return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!name || !content) {
      return NextResponse.json({ message: "name e content são obrigatórios." }, { status: 400 });
    }
    const template = await createTemplate({
      name,
      content,
      category: typeof body.category === "string" ? body.category.trim() || undefined : undefined,
      language: typeof body.language === "string" ? body.language.trim() || undefined : undefined,
      channelType: typeof body.channelType === "string" ? (body.channelType as Parameters<typeof createTemplate>[0]["channelType"]) : undefined,
    });
    return NextResponse.json(template, { status: 201 });
  } catch (e) {
    return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
  }
}
