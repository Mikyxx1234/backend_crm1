import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { enqueueBaileysControl } from "@/lib/queue";
import { getChannelById, markChannelDisconnected } from "@/services/channels";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
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

    if (channel.provider === "BAILEYS_MD") {
      await enqueueBaileysControl({ channelId: id, action: "disconnect" });
    }

    const updated = await markChannelDisconnected(id);
    return NextResponse.json({
      channel: updated,
      message: "Canal desconectado.",
    });
  } catch (e: unknown) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "Erro ao desconectar canal.";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}
