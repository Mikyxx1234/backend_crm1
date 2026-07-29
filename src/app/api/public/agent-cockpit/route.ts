import { NextResponse } from "next/server";

import { withApiAuthContext } from "@/lib/api-auth";
import { getCockpitData } from "@/services/distribution/cockpit";

/**
 * Cockpit do Agente (somente leitura). Autenticado por Bearer token de
 * integração (`Authorization: Bearer <token>`), escopado à organização do
 * token. Alimenta o dashboard estático `public/cockpit-agente.html`.
 */
export async function GET(request: Request) {
  return withApiAuthContext(request, async () => {
    try {
      const data = await getCockpitData();
      return NextResponse.json(data, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (e) {
      console.error("[cockpit] falha ao montar métricas", e);
      return NextResponse.json(
        { message: "Erro ao carregar o cockpit." },
        { status: 500 },
      );
    }
  });
}
