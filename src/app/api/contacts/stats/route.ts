import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { getContactStats } from "@/services/contacts";

export async function GET(request: Request) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

    return await runWithApiUserContext(authResult.user, async () => {
      const stats = await getContactStats();
      return NextResponse.json(stats);
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao carregar estatísticas de contatos.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
