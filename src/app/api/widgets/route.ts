import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { listWidgetsWithState } from "@/services/organization-widgets";

/**
 * GET /api/widgets
 * Lista o catalogo de widgets mesclado com o estado de instalacao da org.
 * Disponivel para qualquer usuario autenticado da organizacao (leitura).
 */
export async function GET() {
  return withOrgContext(async () => {
    try {
      const items = await listWidgetsWithState();
      return NextResponse.json({ items });
    } catch (e) {
      console.error("[GET /api/widgets]", e);
      return NextResponse.json(
        { message: "Erro ao listar widgets." },
        { status: 500 },
      );
    }
  });
}
