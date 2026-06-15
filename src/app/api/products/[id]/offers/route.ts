import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "product:view");
    if (denied) return denied;

    const { id } = await context.params;
    const offers = await prisma.productOffer.findMany({
      where: { productId: id },
      include: { orgUnit: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ offers });
  });
}

export async function POST(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(
      authResult.user,
      "product:manage_offers",
    );
    if (denied) return denied;

    const { id } = await context.params;
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const orgUnitId = typeof body.orgUnitId === "string" ? body.orgUnitId : "";
    if (!orgUnitId) {
      return NextResponse.json({ message: "orgUnitId é obrigatório." }, { status: 400 });
    }

    try {
      const offer = await prisma.productOffer.create({
        data: withOrgFromCtx({
          productId: id,
          orgUnitId,
          price: Number(body.price) || 0,
          discountPct:
            body.discountPct != null ? Number(body.discountPct) || null : null,
          conditions: (body.conditions ?? null) as never,
          active: body.active !== false,
        }),
      });
      return NextResponse.json({ offer }, { status: 201 });
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
        return NextResponse.json(
          { message: "Já existe oferta deste produto para a unidade." },
          { status: 409 },
        );
      }
      throw err;
    }
  });
}
