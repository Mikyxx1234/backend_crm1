/**
 * DELETE /api/deals/[id]/quotas/[quotaId] — remove uma cota do deal.
 *
 * Delega para `QuotaService.removeQuotaFromDeal` que devolve saldo se
 * estava RESERVED e recomputa `priceFinalSnapshot` do deal (RN-07).
 */
import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { getDealById } from "@/services/deals";
import { QuotaError, removeQuotaFromDeal } from "@/services/quota";

type Ctx = { params: Promise<{ id: string; quotaId: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  return withOrgContext(async (session) => {
    const { id, quotaId } = await ctx.params;
    const deal = await getDealById(id);
    if (!deal) {
      return NextResponse.json({ message: "Negócio não encontrado." }, { status: 404 });
    }
    try {
      const result = await removeQuotaFromDeal({
        dealId: id,
        quotaId,
        userId: session.user.id,
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof QuotaError) {
        const status = err.code === "COTA_NAO_VINCULADA" ? 404 : 400;
        return NextResponse.json(
          { code: err.code, message: err.message },
          { status },
        );
      }
      throw err;
    }
  });
}
