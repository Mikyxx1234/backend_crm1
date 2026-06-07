/**
 * POST /api/discount-requests/[id]/approve
 *
 * Aprova solicitação: status PENDING -> APPROVED. Atualiza o DealProduct
 * relacionado setando `discount = discountRequested` e `discountStatus = APPROVED`.
 * Recalcula valor do deal (DealProduct.discount entra no total).
 *
 * Dispara evento `discount_approved` no motor de automações.
 *
 * Permissão: discount:approve.
 *
 * Body opcional: { note?: string } - vai pra DiscountRequest.reviewNote.
 */

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { prisma, type ScopedTx } from "@/lib/prisma";
import { fireTrigger } from "@/services/automation-triggers";

type RouteParams = { params: Promise<{ id: string }> };

const Decimal = Prisma.Decimal;

async function recalcDealValue(tx: ScopedTx, dealId: string) {
  const items = await tx.dealProduct.findMany({
    where: { dealId },
    select: { quantity: true, unitPrice: true, discount: true },
  });
  let total = new Decimal(0);
  for (const item of items) {
    const lineTotal = new Decimal(item.quantity)
      .mul(new Decimal(item.unitPrice))
      .mul(new Decimal(100).minus(new Decimal(item.discount)).div(100));
    total = total.plus(lineTotal);
  }
  await tx.deal.update({ where: { id: dealId }, data: { value: total } });
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return withOrgContext(async (session) => {
    const ctx = await loadAuthzContext({
      userId: session.user.id,
      organizationId: session.user.organizationId,
      isSuperAdmin: session.user.isSuperAdmin,
    });
    if (!can(ctx, "discount:approve")) {
      return NextResponse.json(
        { message: "Acesso negado.", required: "discount:approve" },
        { status: 403 },
      );
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      // body opcional
    }
    const reviewNote = typeof body.note === "string" ? body.note.trim() || null : null;

    const existing = await prisma.discountRequest.findUnique({
      where: { id },
      include: { dealProduct: { select: { id: true, dealId: true } } },
    });
    if (!existing) {
      return NextResponse.json({ message: "Solicitação não encontrada." }, { status: 404 });
    }
    if (existing.status !== "PENDING") {
      return NextResponse.json(
        { message: `Solicitação já está ${existing.status}.`, code: "ALREADY_RESOLVED" },
        { status: 409 },
      );
    }

    const userId = session.user.id;
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const upd = await tx.discountRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          approvedById: userId,
          reviewNote,
          resolvedAt: now,
        },
        include: { product: { select: { id: true, name: true } } },
      });
      await tx.dealProduct.update({
        where: { id: existing.dealProductId },
        data: {
          discount: new Decimal(Number(upd.discountRequested)),
          discountStatus: "APPROVED",
          discountApprovedById: userId,
          discountApprovedAt: now,
        },
      });
      await recalcDealValue(tx, existing.dealProduct.dealId);
      return upd;
    });

    await fireTrigger("discount_approved", {
      dealId: existing.dealProduct.dealId,
      data: {
        organizationId: session.user.organizationId,
        productId: updated.productId,
        productName: updated.product.name,
        dealId: existing.dealProduct.dealId,
        discountRequested: Number(updated.discountRequested),
        discountMax: Number(updated.discountMax),
        userId,
      },
    });

    return NextResponse.json({ request: updated });
  });
}
