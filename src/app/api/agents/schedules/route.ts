import { NextResponse } from "next/server";
import { requireAuth, userOrgFilter } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const r = await requireAuth();
  if (!r.ok) return r.response;

  const users = await prisma.user.findMany({
    where: { type: "HUMAN", ...userOrgFilter(r.session) },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      avatarUrl: true,
      schedule: true,
      // Opt-in administrativo da distribuição (`participates`). Sem registro
      // = default true (mesmo default do model DistributionResponsible).
      distributionResponsibles: {
        select: { participates: true },
        take: 1,
      },
      // Presença ao vivo (ONLINE/AWAY/OFFLINE) — refletida na grade de
      // cobertura (/settings/coverage) como dot no avatar + filtro.
      agentStatus: {
        select: { status: true, availableForVoiceCalls: true, updatedAt: true },
      },
      // Áreas (Departamentos) do agente — alimenta o filtro por área e o
      // agrupamento da grade de cobertura (/settings/coverage).
      departmentMemberships: {
        select: {
          department: { select: { id: true, name: true, color: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(
    users.map(({ departmentMemberships, distributionResponsibles, ...u }) => ({
      ...u,
      departments: departmentMemberships.map((m) => m.department),
      participates: distributionResponsibles[0]?.participates ?? true,
    })),
  );
}
