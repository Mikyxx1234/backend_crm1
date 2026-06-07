/**
 * POST /api/discount-requests/[id]/reject
 *
 * Rejeita solicitação: status PENDING -> REJECTED. DealProduct relacionado
 * fica com `discount = 0` (já estava — só virou definitivo) e
 * `discountStatus = REJECTED`.
 *
 * Dispara evento `discount_rejected` no motor de automações.
 *
 * Permissão: discount:approve.
 *
 * Body opcional: { note?: string } - reviewNote.
 */

import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { fireTrigger } from "@/services/automation-triggers";

type RouteParams = { params: Promise<{ id: string }> };

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
          status: "REJECTED",
          approvedById: userId,
          reviewNote,
          resolvedAt: now,
        },
        include: { product: { select: { id: true, name: true } } },
      });
      await tx.dealProduct.update({
        where: { id: existing.dealProductId },
        data: {
          discountStatus: "REJECTED",
          discountApprovedById: userId,
          discountApprovedAt: now,
        },
      });
      return upd;
    });

    await fireTrigger("discount_rejected", {
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
