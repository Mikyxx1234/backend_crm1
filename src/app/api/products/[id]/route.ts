import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fireTrigger } from "@/services/automation-triggers";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const { id } = await context.params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      customValues: {
        include: { customField: { select: { id: true, name: true, label: true, type: true, options: true } } },
      },
    },
  });
  if (!product) {
    return NextResponse.json({ message: "Produto não encontrado." }, { status: 404 });
  }

  return NextResponse.json({ product });
}

export async function PUT(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.description === "string") data.description = body.description.trim() || null;
  if (typeof body.sku === "string") data.sku = body.sku.trim() || null;
  if (typeof body.price === "number" || typeof body.price === "string") data.price = Number(body.price) || 0;
  if (typeof body.unit === "string") data.unit = body.unit.trim() || "un";
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;

  if (typeof body.type === "string") {
    const t = body.type.toUpperCase();
    if (t === "PRODUCT" || t === "SERVICE") data.type = t;
  }

  // Novos campos do Modulo Catalogo Comercial (aditivos, nao-quebra):
  if (typeof body.code === "string") data.code = body.code.trim() || null;
  if (body.attributes !== undefined) {
    data.attributes = body.attributes === null ? Prisma.JsonNull : (body.attributes as Prisma.InputJsonValue);
  }
  if (body.discountMax !== undefined) {
    if (body.discountMax === null) {
      data.discountMax = null;
    } else {
      const dm = Number(body.discountMax);
      if (Number.isFinite(dm) && dm >= 0 && dm <= 100) data.discountMax = dm;
    }
  }
  if (typeof body.discountRequiresApproval === "boolean") {
    data.discountRequiresApproval = body.discountRequiresApproval;
  }
  if (body.stockAlertAt !== undefined) {
    if (body.stockAlertAt === null) {
      data.stockAlertAt = null;
    } else {
      const sa = Number(body.stockAlertAt);
      if (Number.isFinite(sa) && sa >= 0) data.stockAlertAt = sa;
    }
  }
  if (typeof body.trackStock === "boolean") data.trackStock = body.trackStock;

  try {
    const product = await prisma.product.update({ where: { id }, data });
    // Evento de automacao: offer_updated.
    fireTrigger("offer_updated", {
      data: {
        organizationId: product.organizationId,
        productId: product.id,
        productName: product.name,
        userId: (session.user as { id?: string }).id ?? null,
        changedFields: Object.keys(data),
      },
    }).catch(() => {});
    return NextResponse.json({ product });
  } catch {
    return NextResponse.json({ message: "Produto não encontrado." }, { status: 404 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    await prisma.product.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ message: "Produto não encontrado." }, { status: 404 });
  }
}
