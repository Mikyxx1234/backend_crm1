import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { updateCampaignStatus } from "@/services/campaigns";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }
    const { id } = await params;

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!campaign) {
      return NextResponse.json({ message: "Campanha não encontrada." }, { status: 404 });
    }

    if (campaign.status !== "SENDING" && campaign.status !== "PROCESSING") {
      return NextResponse.json(
        { message: "Apenas campanhas em envio podem ser pausadas." },
        { status: 409 },
      );
    }

    await updateCampaignStatus(id, "PAUSED");
    return NextResponse.json({ message: "Campanha pausada.", status: "PAUSED" });
  } catch (e: unknown) {
    console.error(e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Erro ao pausar campanha." },
      { status: 500 },
    );
  }
}
