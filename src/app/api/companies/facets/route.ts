import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { getCompanyFacets } from "@/services/companies";

export async function GET(request: Request) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

    return await runWithApiUserContext(authResult.user, async () => {
      const facets = await getCompanyFacets();
      return NextResponse.json(facets);
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { message: "Erro ao carregar filtros de empresas." },
      { status: 500 },
    );
  }
}
