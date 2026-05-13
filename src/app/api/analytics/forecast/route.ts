import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getSalesForecast } from "@/services/analytics";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const pipelineIdRaw = searchParams.get("pipelineId");
    const pipelineId =
      pipelineIdRaw && pipelineIdRaw.trim().length > 0
        ? pipelineIdRaw.trim()
        : undefined;

    const data = await getSalesForecast(pipelineId);
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { message: "Erro ao carregar previsão de vendas." },
      { status: 500 }
    );
  }
}
