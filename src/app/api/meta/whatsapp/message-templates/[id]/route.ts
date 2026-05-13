import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { metaWhatsApp } from "@/lib/meta-whatsapp/client";

type RouteContext = { params: Promise<{ id: string }> };

function requireTemplates(): NextResponse | null {
  if (!metaWhatsApp.templatesConfigured) {
    return NextResponse.json(
      { message: "Meta WhatsApp / WABA não configurados." },
      { status: 503 },
    );
  }
  return null;
}

function requireAdminOrManager(session: { user?: { role?: string } }): NextResponse | null {
  const r = session.user?.role;
  if (r !== "ADMIN" && r !== "MANAGER") {
    return NextResponse.json({ message: "Apenas administrador ou gestor." }, { status: 403 });
  }
  return null;
}

/** DELETE: remove template pelo ID Graph (campo `id` na listagem). */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }
    const roleDenied = requireAdminOrManager(session);
    if (roleDenied) return roleDenied;
    const denied = requireTemplates();
    if (denied) return denied;

    const { id } = await context.params;
    if (!id?.trim()) {
      return NextResponse.json({ message: "ID inválido." }, { status: 400 });
    }

    const data = await metaWhatsApp.deleteMessageTemplate(id.trim());
    return NextResponse.json(data ?? { success: true });
  } catch (e: unknown) {
    console.error("[meta-templates] DELETE", e);
    const msg = e instanceof Error ? e.message : "Erro ao excluir template na Meta.";
    return NextResponse.json({ message: msg }, { status: 502 });
  }
}
