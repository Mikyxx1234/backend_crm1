import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getRevenueOverTime, type AnalyticsPeriod } from "@/services/analytics";

function parseRequiredPeriod(
  searchParams: URLSearchParams
): AnalyticsPeriod | null {
  const fromS = searchParams.get("from");
  const toS = searchParams.get("to");
  if (!fromS || !toS) return null;
  const from = new Date(fromS);
  const to = new Date(toS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return { from, to };
}

function parseGroupBy(
  v: string | null
): "day" | "week" | "month" | null {
  if (v === "day" || v === "week" || v === "month") return v;
  return null;
}

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const period = parseRequiredPeriod(searchParams);
    if (!period) {
      return NextResponse.json(
        { message: "Parâmetros obrigatórios: from, to (ISO)." },
        { status: 400 }
      );
    }

    const groupBy = parseGroupBy(searchParams.get("groupBy"));
    if (!groupBy) {
      return NextResponse.json(
        { message: "groupBy deve ser day, week ou month." },
        { status: 400 }
      );
    }

    const data = await getRevenueOverTime(period, groupBy);
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { message: "Erro ao carregar receita ao longo do tempo." },
      { status: 500 }
    );
  }
}
