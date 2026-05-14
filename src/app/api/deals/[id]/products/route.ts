import { Prisma } from "@prisma/client";
const Decimal = Prisma.Decimal;
import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { createDealEvent, getDealById } from "@/services/deals";

type RouteContext = { params: Promise<{ id: string }> };

// Bug 27/abr/26: usavamos `auth()` direto. POST chama `withOrgFromCtx`
// no payload de prisma.dealProduct.create — que avalia ANTES da Prisma
// extension rodar (e portanto antes do fallback de cookie popular ctx).
// Migrado para withOrgContext, que popula o ALS via runWithContext.

async function recalcDealValue(dealId: string) {
  const items = await prisma.dealProduct.findMany({
    where: { dealId },
    select: { quantity: true, unitPrice: true, discount: true },
  });

  let total = new Decimal(0);
  for (const item of items) {
    const qty = new Decimal(item.quantity);
    const price = new Decimal(item.unitPrice);
    const disc = new Decimal(item.discount);
    const lineTotal = qty.mul(price).mul(new Decimal(100).minus(disc).div(100));
    total = total.plus(lineTotal);
  }

  await prisma.deal.update({
    where: { id: dealId },
    data: { value: total },
  });
}

export async function GET(_request: Request, context: RouteContext) {
  return withOrgContext(async () => {
    const { id } = await context.params;
    const existingDeal = await getDealById(id);
    if (!existingDeal) {
      return NextResponse.json({ message: "Negócio não encontrado." }, { status: 404 });
    }
    const dealId = existingDeal.id;

    const items = await prisma.dealProduct.findMany({
      where: { dealId },
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true, type: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const mapped = items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.product.name,
      productSku: item.product.sku,
      unit: item.product.unit,
      productType: item.product.type as "PRODUCT" | "SERVICE",
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      discount: Number(item.discount),
      total: Number(
        new Decimal(item.quantity)
          .mul(new Decimal(item.unitPrice))
          .mul(new Decimal(100).minus(new Decimal(item.discount)).div(100))
      ),
      createdAt: item.createdAt.toISOString(),
    }));

    return NextResponse.json({ items: mapped });
  });
}

export async function POST(request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    const { id } = await context.params;
    const existingDeal = await getDealById(id);
    if (!existingDeal) {
      return NextResponse.json({ message: "Negócio não encontrado." }, { status: 404 });
    }
    const dealId = existingDeal.id;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const productId = typeof body.productId === "string" ? body.productId : "";
    if (!productId) {
      return NextResponse.json({ message: "productId é obrigatório." }, { status: 400 });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { price: true, type: true },
    });
    if (!product) {
      return NextResponse.json({ message: "Produto não encontrado." }, { status: 404 });
    }

    const isService = product.type === "SERVICE";
    const quantity = isService ? 1 : Math.max(0.01, Number(body.quantity) || 1);
    const unitPrice = isService
      ? Number(product.price)
      : (typeof body.unitPrice === "number" || typeof body.unitPrice === "string"
          ? Number(body.unitPrice)
          : Number(product.price));
    const discount = isService ? 0 : Math.min(100, Math.max(0, Number(body.discount) || 0));

    const item = (await prisma.dealProduct.create({
      data: withOrgFromCtx({ dealId, productId, quantity, unitPrice, discount }),
      include: { product: { select: { id: true, name: true, sku: true, unit: true, type: true } } },
    })) as Prisma.DealProductGetPayload<{
      include: { product: { select: { id: true; name: true; sku: true; unit: true; type: true } } };
    }>;

    await recalcDealValue(dealId);

    const lineTotal = Number(
      new Decimal(item.quantity)
        .mul(new Decimal(item.unitPrice))
        .mul(new Decimal(100).minus(new Decimal(item.discount)).div(100))
    );

    const uid = session.user.id;
    createDealEvent(dealId, uid, "PRODUCT_ADDED", {
      productName: item.product.name,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
    }).catch(() => {});

    return NextResponse.json({
      item: {
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        productSku: item.product.sku,
        unit: item.product.unit,
        productType: item.product.type as "PRODUCT" | "SERVICE",
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        discount: Number(item.discount),
        total: lineTotal,
        createdAt: item.createdAt.toISOString(),
      },
    }, { status: 201 });
  });
}
