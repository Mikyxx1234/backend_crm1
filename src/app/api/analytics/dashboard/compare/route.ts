import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getDashboardMetrics, type AnalyticsPeriod } from "@/services/analytics";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const fromS = searchParams.get("from");
    const toS = searchParams.get("to");
    const compFromS = searchParams.get("compFrom");
    const compToS = searchParams.get("compTo");

    if (!fromS || !toS || !compFromS || !compToS) {
      return NextResponse.json(
        { message: "Parâmetros from, to, compFrom e compTo são obrigatórios." },
        { status: 400 },
      );
    }

    const from = new Date(fromS);
    const to = new Date(toS);
    const compFrom = new Date(compFromS);
    const compTo = new Date(compToS);

    if ([from, to, compFrom, compTo].some((d) => Number.isNaN(d.getTime()))) {
      return NextResponse.json(
        { message: "Datas ISO inválidas." },
        { status: 400 },
      );
    }

    const currentPeriod: AnalyticsPeriod = { from, to };
    const previousPeriod: AnalyticsPeriod = { from: compFrom, to: compTo };

    const [current, previous] = await Promise.all([
      getDashboardMetrics(currentPeriod),
      getDashboardMetrics(previousPeriod),
    ]);

    return NextResponse.json({ current, previous });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { message: "Erro ao carregar comparação de métricas." },
      { status: 500 },
    );
  }
}
