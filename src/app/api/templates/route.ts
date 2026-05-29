import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { createTemplate, getTemplates } from "@/services/templates";

// Bug 29/mai/26: usavamos `auth()` direto. createTemplate chama
// `withOrgFromCtx({...})` que exige RequestContext ativo, e
// getTemplates depende da Prisma Extension multi-tenant pra filtrar
// por organizationId. Sem `withOrgContext` envolvendo o handler:
//   - GET retornava silenciosamente templates de outras orgs ou nada
//     (`__none__` filter), dependendo do estado do AsyncLocalStorage.
//   - POST falhava com 500 silencioso porque `withOrgFromCtx` jogava
//     erro genérico capturado pelo catch.
// UI mostrava "Criar" sem efeito visual — clique morria no 500.
// Migrado pra `withOrgContext` (padrão das demais 26 rotas corrigidas).
export async function GET() {
  return withOrgContext(async () => {
    try {
      const templates = await getTemplates();
      return NextResponse.json(templates);
    } catch (e) {
      console.error("[templates GET]", e);
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro ao listar templates." },
        { status: 500 },
      );
    }
  });
}

export async function POST(request: Request) {
  return withOrgContext(async () => {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const content = typeof body.content === "string" ? body.content.trim() : "";
      if (!name || !content) {
        return NextResponse.json(
          { message: "name e content são obrigatórios." },
          { status: 400 },
        );
      }
      const template = await createTemplate({
        name,
        content,
        category:
          typeof body.category === "string" ? body.category.trim() || undefined : undefined,
        language:
          typeof body.language === "string" ? body.language.trim() || undefined : undefined,
        channelType:
          typeof body.channelType === "string"
            ? (body.channelType as Parameters<typeof createTemplate>[0]["channelType"])
            : undefined,
      });
      return NextResponse.json(template, { status: 201 });
    } catch (e) {
      console.error("[templates POST]", e);
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro ao criar template." },
        { status: 500 },
      );
    }
  });
}
