import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getCampaignStats } from "@/services/campaigns";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }
    const { id } = await params;
    const stats = await getCampaignStats(id);
    return NextResponse.json(stats);
  } catch (e: unknown) {
    console.error(e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Erro ao buscar estatísticas." },
      { status: 500 },
    );
  }
}
