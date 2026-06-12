import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string; offerId: string }> };

export async function PUT(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(
      authResult.user,
      "product:manage_offers",
    );
    if (denied) return denied;

    const { offerId } = await context.params;
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (body.price != null) data.price = Number(body.price) || 0;
    if (body.discountPct !== undefined) {
      data.discountPct = body.discountPct != null ? Number(body.discountPct) || null : null;
    }
    if (body.conditions !== undefined) data.conditions = (body.conditions ?? null) as never;
    if (typeof body.active === "boolean") data.active = body.active;

    try {
      const offer = await prisma.productOffer.update({ where: { id: offerId }, data });
      return NextResponse.json({ offer });
    } catch {
      return NextResponse.json({ message: "Oferta não encontrada." }, { status: 404 });
    }
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(
      authResult.user,
      "product:manage_offers",
    );
    if (denied) return denied;

    const { offerId } = await context.params;
    try {
      await prisma.productOffer.delete({ where: { id: offerId } });
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ message: "Oferta não encontrada." }, { status: 404 });
    }
  });
}
