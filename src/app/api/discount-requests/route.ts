/**
 * GET /api/discount-requests — lista solicitações de desconto da org
 *
 * Query:
 *   status=PENDING|APPROVED|REJECTED   (default: PENDING)
 *   productId=<id>
 *   dealId=<id>
 *   limit / offset
 *
 * Visibilidade:
 *   - Com `discount:approve`: vê todas da org.
 *   - Sem `discount:approve` mas com `discount:view`: vê só as próprias
 *     (filtro `requestedById = currentUserId`).
 *   - Sem `discount:view`: 403.
 */

import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  return withOrgContext(async (session) => {
    const ctx = await loadAuthzContext({
      userId: session.user.id,
      organizationId: session.user.organizationId,
      isSuperAdmin: session.user.isSuperAdmin,
    });
    const canApprove = can(ctx, "discount:approve");
    const canView = canApprove || can(ctx, "discount:view");
    if (!canView) {
      return NextResponse.json(
        { message: "Acesso negado.", required: "discount:view" },
        { status: 403 },
      );
    }

    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? "PENDING";
    const productId = url.searchParams.get("productId");
    const dealId = url.searchParams.get("dealId");
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

    const where: Record<string, unknown> = {};
    if (status && status !== "ALL") where.status = status;
    if (productId) where.productId = productId;
    if (dealId) where.dealProduct = { dealId };
    if (!canApprove) where.requestedById = session.user.id;

    const [requests, total] = await Promise.all([
      prisma.discountRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        include: {
          product: { select: { id: true, name: true, sku: true } },
          requestedBy: { select: { id: true, name: true, avatarUrl: true } },
          approvedBy: { select: { id: true, name: true } },
          dealProduct: {
            select: {
              id: true,
              dealId: true,
              quantity: true,
              unitPrice: true,
              deal: { select: { id: true, title: true, number: true } },
            },
          },
        },
      }),
      prisma.discountRequest.count({ where }),
    ]);

    return NextResponse.json({ requests, total, limit, offset, canApprove });
  });
}
