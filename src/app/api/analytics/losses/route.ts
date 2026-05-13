import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function toNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "object" && v !== null && "toNumber" in v) {
    const d = v as { toNumber: () => number };
    if (typeof d.toNumber === "function") return d.toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const fromS = searchParams.get("from");
    const toS = searchParams.get("to");

    let dateFilter = Prisma.sql`TRUE`;
    if (fromS && toS) {
      const from = new Date(fromS);
      const to = new Date(toS);
      if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
        dateFilter = Prisma.sql`d."closedAt" >= ${from} AND d."closedAt" <= ${to}`;
      }
    }

    const rows = await prisma.$queryRaw<
      { reason: string; count: bigint; total_value: unknown }[]
    >(Prisma.sql`
      SELECT
        COALESCE(NULLIF(TRIM(d."lostReason"), ''), '(sem motivo)') AS reason,
        COUNT(*)::bigint AS count,
        COALESCE(SUM(CAST(d.value AS DECIMAL)), 0) AS total_value
      FROM deals d
      WHERE d.status = 'LOST'::"DealStatus"
        AND ${dateFilter}
      GROUP BY reason
      ORDER BY count DESC
    `);

    const items = rows.map((r) => ({
      reason: r.reason,
      count: Number(r.count),
      totalValue: Math.round(toNumber(r.total_value) * 100) / 100,
    }));

    const totalLost = items.reduce((s, i) => s + i.count, 0);
    const totalValue = items.reduce((s, i) => s + i.totalValue, 0);

    return NextResponse.json({ items, totalLost, totalValue: Math.round(totalValue * 100) / 100 });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { message: "Erro ao carregar motivos de perda." },
      { status: 500 },
    );
  }
}
