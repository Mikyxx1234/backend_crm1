/**
 * GET /api/deals/[id]/cotas-disponiveis — RN-01.
 *
 * Retorna cotas elegíveis para o deal considerando produto(s) vinculados e
 * `orgUnitId` do deal. Também traz a lista de cotas já vinculadas (para
 * a UI destacar as combináveis e checar cumulatividade em tempo real).
 *
 * Query params opcionais:
 *   - `productId`: força o matching a um produto específico (ex.: o
 *     vendedor quer saber quais cotas caberiam se adicionasse esse produto).
 */
import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getDealById } from "@/services/deals";
import { listAvailableForDeal } from "@/services/quota";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return withOrgContext(async () => {
    const { id } = await ctx.params;
    const deal = await getDealById(id);
    if (!deal) {
      return NextResponse.json({ message: "Negócio não encontrado." }, { status: 404 });
    }

    const url = new URL(request.url);
    const productIdOverride = url.searchParams.get("productId")?.trim();

    // Descobre os produtos vinculados; a UI pode iterar os produtos e a
    // API filtrar por um específico (query param). Default: pegamos o
    // primeiro produto (caso curso: 1 oferta por deal).
    const dealProducts = await prisma.dealProduct.findMany({
      where: { dealId: id },
      select: { productId: true },
      orderBy: { createdAt: "asc" },
    });
    const productId =
      productIdOverride ||
      dealProducts[0]?.productId ||
      null;

    const available = await listAvailableForDeal({
      productId,
      orgUnitId: deal.orgUnitId ?? null,
    });

    const already = await prisma.dealQuota.findMany({
      where: {
        dealId: id,
        status: { in: ["SELECTED", "RESERVED", "CONSUMED"] },
      },
      select: { quotaId: true },
    });
    const linkedIds = new Set(already.map((a) => a.quotaId));

    return NextResponse.json({
      quotas: available.map((q) => ({ ...q, linked: linkedIds.has(q.id) })),
      dealOrgUnitId: deal.orgUnitId,
      resolvedProductId: productId,
    });
  });
}
