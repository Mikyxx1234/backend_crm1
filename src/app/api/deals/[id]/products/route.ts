import { Prisma } from "@prisma/client";
const Decimal = Prisma.Decimal;
import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { createDealEvent, getDealById } from "@/services/deals";
import { fireTrigger } from "@/services/automation-triggers";
import { recordStockMovement } from "@/services/stock";

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
      select: {
        id: true,
        organizationId: true,
        price: true,
        type: true,
        discountMax: true,
        discountRequiresApproval: true,
        trackStock: true,
        name: true,
      },
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
    const requestedDiscount = isService ? 0 : Math.min(100, Math.max(0, Number(body.discount) || 0));
    const discountNote = typeof body.discountNote === "string" ? body.discountNote.trim() || null : null;

    // Politica de desconto: se discount solicitado <= product.discountMax,
    // aplica direto. Se exceder e o produto exigir aprovacao, deixa em 0
    // ate o gestor aprovar (cria DiscountRequest). Se exceder e NAO exigir
    // aprovacao, rejeita com 400 (politica nao permite agente passar do limite).
    const discountMax = product.discountMax !== null ? Number(product.discountMax) : null;
    const needsApproval =
      discountMax !== null &&
      requestedDiscount > discountMax &&
      product.discountRequiresApproval === true;
    const exceedsWithoutApprovalFlag =
      discountMax !== null &&
      requestedDiscount > discountMax &&
      product.discountRequiresApproval === false;

    if (exceedsWithoutApprovalFlag) {
      return NextResponse.json(
        {
          message: `Desconto excede o limite (${discountMax}%) e este produto não aceita aprovação.`,
          code: "DISCOUNT_EXCEEDS_MAX",
          discountMax,
        },
        { status: 400 },
      );
    }

    const effectiveDiscount = needsApproval ? 0 : requestedDiscount;
    const discountStatus = needsApproval ? "PENDING_APPROVAL" : "NA";
    const uid = session.user.id;
    const organizationId = product.organizationId;

    const { item, discountRequest } = await prisma.$transaction(async (tx) => {
      const created = await tx.dealProduct.create({
        data: withOrgFromCtx({
          dealId,
          productId,
          quantity,
          unitPrice,
          discount: effectiveDiscount,
          discountRequested: requestedDiscount,
          discountStatus,
          discountNote,
        }),
        include: {
          product: {
            select: { id: true, name: true, sku: true, unit: true, type: true },
          },
        },
      });

      let dr = null as null | { id: string };
      if (needsApproval) {
        dr = await tx.discountRequest.create({
          data: {
            organizationId,
            dealProductId: created.id,
            productId,
            requestedById: uid,
            discountRequested: new Decimal(requestedDiscount),
            discountMax: new Decimal(discountMax ?? 0),
            status: "PENDING",
            note: discountNote,
          },
          select: { id: true },
        });
      }

      if (product.trackStock && quantity > 0) {
        await recordStockMovement(tx, {
          organizationId,
          productId,
          dealId,
          userId: uid,
          type: "RESERVE",
          quantity,
          reason: "deal_product_added",
        });
      }

      return { item: created, discountRequest: dr };
    });

    // Recalc fora da transacao (ja escreveu o DealProduct; recalc le e atualiza)
    await recalcDealValue(dealId);

    const lineTotal = Number(
      new Decimal(item.quantity)
        .mul(new Decimal(item.unitPrice))
        .mul(new Decimal(100).minus(new Decimal(item.discount)).div(100))
    );

    createDealEvent(dealId, uid, "PRODUCT_ADDED", {
      productName: item.product.name,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
    }).catch(() => {});

    // Eventos de automacao apos COMMIT
    fireTrigger("deal_product_added", {
      dealId,
      data: {
        organizationId,
        productId,
        productName: product.name,
        dealId,
        quantity,
        userId: uid,
      },
    }).catch(() => {});
    if (discountRequest) {
      fireTrigger("discount_requested", {
        dealId,
        data: {
          organizationId,
          productId,
          productName: product.name,
          dealId,
          discountRequested: requestedDiscount,
          discountMax,
          userId: uid,
        },
      }).catch(() => {});
    }

    return NextResponse.json(
      {
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
          discountRequested: requestedDiscount,
          discountStatus,
          total: lineTotal,
          createdAt: item.createdAt.toISOString(),
        },
        discountRequest,
      },
      { status: 201 },
    );
  });
}
