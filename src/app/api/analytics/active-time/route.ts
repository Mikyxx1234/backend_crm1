import { NextResponse } from "next/server";

import { computeActiveTimeByUser } from "@/lib/agent-presence";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Retorna, para cada agente ativo do workspace, o tempo acumulado (ms) em cada
 * status (ONLINE/AWAY/OFFLINE) dentro do intervalo [from, to]. Usado pelo
 * dashboard Monitor para mostrar "Active Time vs Offline" por período.
 *
 * Query params:
 *   - from (ISO date, opcional; default = início de hoje local do servidor)
 *   - to   (ISO date, opcional; default = agora)
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const from = fromParam ? new Date(fromParam) : startOfDay;
  const to = toParam ? new Date(toParam) : now;

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json(
      { message: "Datas 'from'/'to' inválidas." },
      { status: 400 },
    );
  }
  if (from > to) {
    return NextResponse.json(
      { message: "'from' precisa ser anterior a 'to'." },
      { status: 400 },
    );
  }

  const users = await prisma.user.findMany({
    where: {
      type: "HUMAN",
      role: { in: ["ADMIN", "MANAGER", "MEMBER"] },
    },
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      agentStatus: { select: { status: true, lastActivityAt: true } },
    },
    orderBy: { name: "asc" },
  });

  const userIds = users.map((u) => u.id);
  const active = await computeActiveTimeByUser({ from, to, userIds });

  const totalWindowMs = Math.max(0, to.getTime() - from.getTime());

  const agents = users.map((u) => {
    const agg = active.get(u.id) ?? { online: 0, away: 0, offline: 0 };
    // Tempo "sem registro" = janela total - soma dos blocos conhecidos.
    // Tratamos como offline para a UI (agente nunca logou no período).
    const tracked = agg.online + agg.away + agg.offline;
    const untracked = Math.max(0, totalWindowMs - tracked);

    return {
      userId: u.id,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatarUrl,
      currentStatus: u.agentStatus?.status ?? "OFFLINE",
      lastActivityAt: u.agentStatus?.lastActivityAt ?? null,
      activeMs: agg.online,
      awayMs: agg.away,
      offlineMs: agg.offline + untracked,
      utilizationPct:
        totalWindowMs > 0
          ? Math.round((agg.online / totalWindowMs) * 1000) / 10
          : 0,
    };
  });

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    windowMs: totalWindowMs,
    agents,
  });
}
