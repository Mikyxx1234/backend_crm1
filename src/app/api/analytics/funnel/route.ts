import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getFunnelData } from "@/services/analytics";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const pipelineId = searchParams.get("pipelineId");
    if (!pipelineId?.trim()) {
      return NextResponse.json(
        { message: "pipelineId é obrigatório." },
        { status: 400 }
      );
    }

    const data = await getFunnelData(pipelineId);
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { message: "Erro ao carregar dados do funil." },
      { status: 500 }
    );
  }
}
