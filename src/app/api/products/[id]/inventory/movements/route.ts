import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import {
  InsufficientInventoryError,
  consume,
  getPoolStats,
  release,
  reserve,
  restock,
} from "@/services/inventory";

type RouteContext = { params: Promise<{ id: string }> };

const OPERATIONS = new Set(["restock", "consume", "reserve", "release"]);

export async function POST(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "inventory:adjust");
    if (denied) return denied;

    const { id: productId } = await context.params;
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const operation =
      typeof body.operation === "string" && OPERATIONS.has(body.operation)
        ? body.operation
        : "restock";
    const qty = Math.floor(Number(body.qty) || 0);
    if (qty <= 0) {
      return NextResponse.json({ message: "Quantidade deve ser > 0." }, { status: 400 });
    }
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!note) {
      return NextResponse.json({ message: "Motivo (note) é obrigatório." }, { status: 400 });
    }

    // Resolve/cria o pool.
    let poolId = typeof body.poolId === "string" && body.poolId ? body.poolId : "";
    if (!poolId) {
      const created = await prisma.inventoryPool.create({
        data: withOrgFromCtx({
          productId,
          orgUnitId:
            typeof body.orgUnitId === "string" && body.orgUnitId ? body.orgUnitId : null,
          consumeTrigger:
            typeof body.consumeTrigger === "string"
              ? (body.consumeTrigger as never)
              : ("MANUAL" as never),
          allowNegative: body.allowNegative === true,
        }),
        select: { id: true },
      });
      poolId = created.id;
    }

    const actorId = (authResult.user as { id?: string }).id ?? null;
    const common = { poolId, qty, dealId: null, actorId, actorType: "HUMAN", note };

    try {
      if (operation === "restock") {
        await restock(common);
      } else if (operation === "consume") {
        await consume({ ...common, reason: "ADJUSTMENT" });
      } else if (operation === "reserve") {
        await reserve(common);
      } else {
        await release(common);
      }
    } catch (err) {
      if (err instanceof InsufficientInventoryError) {
        return NextResponse.json(
          {
            message: `Saldo insuficiente: disponível ${err.available}, solicitado ${err.requested}.`,
            code: err.code,
          },
          { status: 409 },
        );
      }
      throw err;
    }

    const stats = await getPoolStats(poolId);
    return NextResponse.json({ poolId, stats }, { status: 201 });
  });
}
