/**
 * /api/deals/[id]/quotas — Cotas vinculadas + seleção (RN-02/03/05/06).
 *
 * GET  → lista `deal_quotas` vinculados ao deal (com snapshot + status).
 * POST → seleciona uma cota (delega para `QuotaService.selectQuotaForDeal`
 *        que valida cumulatividade, aplica RN-05 e faz consumo atômico
 *        via UPDATE condicional na mesma transação).
 *
 * Erros do serviço são mapeados para HTTP 400/409 com códigos semânticos
 * (`COTA_ESGOTADA`, `COTA_NAO_ACUMULAVEL`, …). O front usa o `code` para
 * exibir a mensagem correta e destacar o botão certo.
 */
import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { QuotaError, selectQuotaForDeal } from "@/services/quota";
import { getDealById } from "@/services/deals";

type Ctx = { params: Promise<{ id: string }> };

function mapQuotaError(err: QuotaError): { status: number; code: string; message: string } {
  const httpByCode: Record<string, number> = {
    COTA_ESGOTADA: 409,
    COTA_NAO_ACUMULAVEL: 409,
    COTA_FORA_VIGENCIA: 400,
    COTA_ESCOPO_INVALIDO: 400,
    COTA_JA_VINCULADA: 409,
    COTA_INEXISTENTE: 404,
    DEAL_INEXISTENTE: 404,
    RESERVA_EXPIRADA: 409,
  };
  return {
    status: httpByCode[err.code] ?? 400,
    code: err.code,
    message: err.message,
  };
}

export async function GET(_req: Request, ctx: Ctx) {
  return withOrgContext(async () => {
    const { id } = await ctx.params;
    const deal = await getDealById(id);
    if (!deal) {
      return NextResponse.json({ message: "Negócio não encontrado." }, { status: 404 });
    }

    const rows = await prisma.dealQuota.findMany({
      where: { dealId: id },
      orderBy: { createdAt: "asc" },
      include: {
        quota: {
          select: {
            id: true,
            name: true,
            discountType: true,
            discountValue: true,
            calcMode: true,
            productId: true,
            orgUnitId: true,
            qtyTotal: true,
            qtyConsumed: true,
            validTo: true,
          },
        },
      },
    });

    return NextResponse.json({
      items: rows.map((r) => ({
        id: r.id,
        quotaId: r.quotaId,
        status: r.status,
        valueSnapshot: Number(r.valueSnapshot),
        typeSnapshot: r.typeSnapshot,
        reservedAt: r.reservedAt?.toISOString() ?? null,
        expiresAt: r.expiresAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        quota: {
          ...r.quota,
          discountValue: Number(r.quota.discountValue),
          balance:
            r.quota.qtyTotal === null
              ? null
              : r.quota.qtyTotal - r.quota.qtyConsumed,
        },
      })),
      priceFullSnapshot:
        deal.priceFullSnapshot === null || deal.priceFullSnapshot === undefined
          ? null
          : Number(deal.priceFullSnapshot),
      priceFinalSnapshot:
        deal.priceFinalSnapshot === null || deal.priceFinalSnapshot === undefined
          ? null
          : Number(deal.priceFinalSnapshot),
    });
  });
}

export async function POST(request: Request, ctx: Ctx) {
  return withOrgContext(async (session) => {
    const { id } = await ctx.params;
    const deal = await getDealById(id);
    if (!deal) {
      return NextResponse.json({ message: "Negócio não encontrado." }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }
    const quotaId = typeof body.quotaId === "string" ? body.quotaId : "";
    if (!quotaId) {
      return NextResponse.json({ message: "quotaId é obrigatório." }, { status: 400 });
    }

    try {
      const result = await selectQuotaForDeal({
        dealId: id,
        quotaId,
        userId: session.user.id,
      });
      return NextResponse.json(result, { status: 201 });
    } catch (err) {
      if (err instanceof QuotaError) {
        const mapped = mapQuotaError(err);
        return NextResponse.json(
          { code: mapped.code, message: mapped.message },
          { status: mapped.status },
        );
      }
      throw err;
    }
  });
}
