/**
 * GET /api/discount-requests/[id] — detalhe.
 *
 * Visibilidade idêntica à do índice: aprovadores veem qualquer; demais
 * só as próprias.
 */

import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const { id } = await params;
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

    const request = await prisma.discountRequest.findUnique({
      where: { id },
      include: {
        product: { select: { id: true, name: true, sku: true, discountMax: true } },
        requestedBy: { select: { id: true, name: true, avatarUrl: true, email: true } },
        approvedBy: { select: { id: true, name: true } },
        dealProduct: {
          include: {
            deal: { select: { id: true, title: true, number: true, status: true } },
          },
        },
      },
    });
    if (!request) {
      return NextResponse.json({ message: "Solicitação não encontrada." }, { status: 404 });
    }
    if (!canApprove && request.requestedById !== session.user.id) {
      return NextResponse.json(
        { message: "Acesso negado a esta solicitação." },
        { status: 403 },
      );
    }
    return NextResponse.json({ request });
  });
}
