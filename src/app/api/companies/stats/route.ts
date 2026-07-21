import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { getCompanyStats } from "@/services/companies";

export async function GET(request: Request) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

    return await runWithApiUserContext(authResult.user, async () => {
      const stats = await getCompanyStats();
      return NextResponse.json(stats);
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao carregar estatísticas de empresas.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
