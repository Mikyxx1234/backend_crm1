import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";
import { getPoolStats } from "@/services/inventory";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "inventory:view");
    if (denied) return denied;

    const { id } = await context.params;
    const pools = await prisma.inventoryPool.findMany({
      where: { productId: id },
      include: { orgUnit: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });

    const poolsWithStats = await Promise.all(
      pools.map(async (p) => ({
        id: p.id,
        orgUnit: p.orgUnit,
        consumeTrigger: p.consumeTrigger,
        allowNegative: p.allowNegative,
        stats: await getPoolStats(p.id),
      })),
    );

    const url = new URL(request.url);
    const poolFilter = url.searchParams.get("poolId");
    const movements = await prisma.inventoryMovement.findMany({
      where: {
        poolId: poolFilter
          ? poolFilter
          : { in: pools.map((p) => p.id) },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        poolId: true,
        delta: true,
        reason: true,
        dealId: true,
        actorId: true,
        actorType: true,
        note: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ pools: poolsWithStats, movements });
  });
}
