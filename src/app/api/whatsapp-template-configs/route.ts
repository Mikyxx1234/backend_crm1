import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }
    const configs = await prisma.whatsAppTemplateConfig.findMany({
      orderBy: { metaTemplateName: "asc" },
    });
    return NextResponse.json(configs);
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Erro." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== "ADMIN" && role !== "MANAGER") {
      return NextResponse.json({ message: "Apenas administrador ou gestor." }, { status: 403 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const metaTemplateId = typeof body.metaTemplateId === "string" ? body.metaTemplateId.trim() : "";
    const metaTemplateName = typeof body.metaTemplateName === "string" ? body.metaTemplateName.trim() : "";
    if (!metaTemplateId || !metaTemplateName) {
      return NextResponse.json({ message: "metaTemplateId e metaTemplateName obrigatórios." }, { status: 400 });
    }

    const label = typeof body.label === "string" ? body.label.trim() : "";
    const agentEnabled = body.agentEnabled === true;
    const language = typeof body.language === "string" ? body.language.trim() || "pt_BR" : "pt_BR";
    const category = typeof body.category === "string" ? body.category.trim() || null : null;
    const bodyPreview = typeof body.bodyPreview === "string" ? body.bodyPreview.slice(0, 500) : "";

    const config = await prisma.whatsAppTemplateConfig.upsert({
      where: { metaTemplateId },
      create: { metaTemplateId, metaTemplateName, label, agentEnabled, language, category, bodyPreview },
      update: { metaTemplateName, label, agentEnabled, language, category, bodyPreview },
    });

    return NextResponse.json(config);
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Erro." },
      { status: 500 },
    );
  }
}
