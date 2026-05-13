import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getInboxMetrics } from "@/services/analytics";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Nao autorizado." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const period =
      from && to
        ? { from: new Date(from), to: new Date(to) }
        : undefined;

    const data = await getInboxMetrics(period);
    return NextResponse.json(data);
  } catch (e) {
    console.error("[analytics/inbox]", e);
    return NextResponse.json(
      { message: "Erro ao carregar metricas de atendimento." },
      { status: 500 }
    );
  }
}
