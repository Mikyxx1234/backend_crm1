import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getChannelById } from "@/services/channels";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { id } = await context.params;
    const channel = await getChannelById(id);
    if (!channel) {
      return NextResponse.json({ message: "Canal não encontrado." }, { status: 404 });
    }

    return NextResponse.json({
      status: channel.status,
      phoneNumber: channel.phoneNumber ?? undefined,
    });
  } catch (e: unknown) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "Erro ao consultar status.";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}
