/**
 * PUT    /api/contracts/[id]/items/[itemId]  — edita quantity/balance (gera ADJUSTMENT)
 * DELETE /api/contracts/[id]/items/[itemId]  — remove item (rejeita se houver consumido)
 *
 * Permissão: product:manage
 *
 * Regras:
 *   - PUT permite editar `unitPrice`, `discount`, `quantity`. Se `quantity`
 *     mudar, gera StockMovement ADJUSTMENT (INCREASE ou DECREASE) ajustando
 *     ContractItem.balance proporcionalmente.
 *   - DELETE só permitido se `consumed = 0` e `reserved = 0`.
 */

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/request-context";
import { recordStockMovement } from "@/services/stock";

type RouteParams = { params: Promise<{ id: string; itemId: string }> };

export async function PUT(request: Request, { params }: RouteParams) {
  const { id, itemId } = await params;
  return withOrgContext(async (session) => {
    const ctx = await loadAuthzContext({
      userId: session.user.id,
      organizationId: session.user.organizationId,
      isSuperAdmin: session.user.isSuperAdmin,
    });
    if (!can(ctx, "product:manage")) {
      return NextResponse.json(
        { message: "Acesso negado.", required: "product:manage" },
        { status: 403 },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const existing = await prisma.contractItem.findFirst({
      where: { id: itemId, contractId: id },
    });
    if (!existing) {
      return NextResponse.json({ message: "Item não encontrado." }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    let deltaQty = 0;

    if (body.quantity !== undefined) {
      const q = Number(body.quantity);
      if (!Number.isFinite(q) || q <= 0) {
        return NextResponse.json({ message: "quantity inválida." }, { status: 400 });
      }
      data.quantity = new Prisma.Decimal(q);
      deltaQty = q - Number(existing.quantity);
    }
    if (body.unitPrice !== undefined) {
      const u = Number(body.unitPrice);
      if (!Number.isFinite(u) || u < 0) {
        return NextResponse.json({ message: "unitPrice inválido." }, { status: 400 });
      }
      data.unitPrice = new Prisma.Decimal(u);
    }
    if (body.discount !== undefined) {
      const d = Number(body.discount);
      if (!Number.isFinite(d) || d < 0 || d > 100) {
        return NextResponse.json({ message: "discount inválido." }, { status: 400 });
      }
      data.discount = new Prisma.Decimal(d);
    }

    const reqCtx = getRequestContext();
    const userId = reqCtx?.userId ?? null;
    const organizationId = session.user.organizationId;
    if (!organizationId) {
      return NextResponse.json({ message: "organização não resolvida." }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.contractItem.update({ where: { id: itemId }, data });
      if (deltaQty !== 0) {
        await recordStockMovement(tx, {
          organizationId,
          productId: existing.productId,
          contractItemId: itemId,
          userId,
          type: "ADJUSTMENT",
          quantity: Math.abs(deltaQty),
          reason: "contract_item_quantity_changed",
          metadata: { direction: deltaQty > 0 ? "INCREASE" : "DECREASE" },
        });
      }
      return tx.contractItem.findUnique({
        where: { id: itemId },
        include: { product: { select: { id: true, name: true, sku: true } } },
      });
    });

    return NextResponse.json({ item: updated });
  });
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const { id, itemId } = await params;
  return withOrgContext(async (session) => {
    const ctx = await loadAuthzContext({
      userId: session.user.id,
      organizationId: session.user.organizationId,
      isSuperAdmin: session.user.isSuperAdmin,
    });
    if (!can(ctx, "product:manage")) {
      return NextResponse.json(
        { message: "Acesso negado.", required: "product:manage" },
        { status: 403 },
      );
    }

    const existing = await prisma.contractItem.findFirst({
      where: { id: itemId, contractId: id },
    });
    if (!existing) {
      return NextResponse.json({ message: "Item não encontrado." }, { status: 404 });
    }
    if (Number(existing.consumed) > 0 || Number(existing.reserved) > 0) {
      return NextResponse.json(
        {
          message: "Item com consumo/reserva não pode ser removido. Cancele o contrato.",
          code: "CONTRACT_ITEM_IN_USE",
        },
        { status: 409 },
      );
    }

    await prisma.contractItem.delete({ where: { id: itemId } });
    return NextResponse.json({ ok: true });
  });
}
