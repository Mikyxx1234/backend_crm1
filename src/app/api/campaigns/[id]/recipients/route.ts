import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getCampaignRecipients } from "@/services/campaigns";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }
    const { id } = await params;
    const { searchParams } = new URL(request.url);

    const result = await getCampaignRecipients({
      campaignId: id,
      status: searchParams.get("status") ?? undefined,
      page: Number(searchParams.get("page")) || 1,
      perPage: Number(searchParams.get("perPage")) || 50,
    });

    return NextResponse.json(result);
  } catch (e: unknown) {
    console.error(e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Erro ao listar destinatários." },
      { status: 500 },
    );
  }
}
