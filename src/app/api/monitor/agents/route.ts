import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type AgentRow = {
  userId: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
  status: "ONLINE" | "AWAY" | "OFFLINE";
  availableForVoiceCalls: boolean;
  lastActivityAt: string | null;
  statusUpdatedAt: string | null;
};

/**
 * Endpoint dedicado à War Room (/monitor).
 *
 * Usa $queryRaw para não depender do Prisma Client conhecer `lastActivityAt`
 * (coluna adicionada na migration 20260417000100). Quando o Prisma Client é
 * regenerado no build Docker, esta rota continua funcionando igual.
 *
 * Fallback: se a coluna ainda não existe no banco (migration pendente),
 * retorna lista sem lastActivityAt (tratado como null no UI).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  try {
    const rows = await prisma.$queryRawUnsafe<AgentRow[]>(`
      SELECT
        u.id                               AS "userId",
        u.name                             AS name,
        u.email                            AS email,
        u.role                             AS role,
        u."avatarUrl"                      AS "avatarUrl",
        COALESCE(a.status, 'OFFLINE')      AS status,
        COALESCE(a."availableForVoiceCalls", false) AS "availableForVoiceCalls",
        to_char(a."lastActivityAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastActivityAt",
        to_char(a."updatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "statusUpdatedAt"
      FROM users u
      LEFT JOIN agent_statuses a ON a."userId" = u.id
      WHERE u."type" = 'HUMAN'
      ORDER BY
        CASE COALESCE(a.status, 'OFFLINE')
          WHEN 'ONLINE'  THEN 0
          WHEN 'AWAY'    THEN 1
          WHEN 'OFFLINE' THEN 2
        END,
        u.name ASC
    `);

    return NextResponse.json(rows);
  } catch (err) {
    console.warn(
      "[/api/monitor/agents] fallback (provável migration pendente):",
      err instanceof Error ? err.message : err
    );

    // Fallback sem lastActivityAt (coluna ainda não existe em prod).
    const users = await prisma.user.findMany({
      where: { type: "HUMAN" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
        agentStatus: { select: { status: true, availableForVoiceCalls: true, updatedAt: true } },
      },
      orderBy: { name: "asc" },
    });

    const rows: AgentRow[] = users.map((u) => ({
      userId: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      avatarUrl: u.avatarUrl,
      status: (u.agentStatus?.status as AgentRow["status"]) ?? "OFFLINE",
      availableForVoiceCalls: u.agentStatus?.availableForVoiceCalls ?? false,
      lastActivityAt: null,
      statusUpdatedAt: u.agentStatus?.updatedAt?.toISOString() ?? null,
    }));

    return NextResponse.json(rows);
  }
}
