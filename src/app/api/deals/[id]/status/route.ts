import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fireTrigger } from "@/services/automation-triggers";
import { createDealEvent, getDealById, markDealLost, markDealWon, reopenDeal } from "@/services/deals";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ message: "ID inválido." }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Corpo inválido." }, { status: 400 });
    }

    const b = body as Record<string, unknown>;
    if (b.status !== "WON" && b.status !== "LOST" && b.status !== "OPEN") {
      return NextResponse.json(
        { message: "status deve ser WON, LOST ou OPEN." },
        { status: 400 }
      );
    }

    const existing = await getDealById(id);
    if (!existing) {
      return NextResponse.json({ message: "Negócio não encontrado." }, { status: 404 });
    }

    const dealId = existing.id;

    try {
      const uid = (session.user as { id: string }).id;
      const fromStatus = existing.status;

      if (b.status === "WON") {
        const deal = await markDealWon(dealId);
        createDealEvent(dealId, uid, "STATUS_CHANGED", { from: fromStatus, to: "WON" }).catch(() => {});
        fireTrigger("deal_won", { dealId, contactId: existing.contactId ?? undefined, data: { fromStatus } }).catch(() => {});
        return NextResponse.json(deal);
      }
      if (b.status === "LOST") {
        const reason = typeof b.lostReason === "string" ? b.lostReason.trim() : "";
        const requireSetting = await prisma.systemSetting.findUnique({ where: { key: "loss_reason_required" } }).catch(() => null);
        if ((requireSetting?.value === "true" || !reason) && !reason) {
          return NextResponse.json(
            { message: "lostReason é obrigatório quando status é LOST." },
            { status: 400 }
          );
        }
        const deal = await markDealLost(dealId, reason);
        createDealEvent(dealId, uid, "STATUS_CHANGED", { from: fromStatus, to: "LOST", lostReason: reason }).catch(() => {});
        fireTrigger("deal_lost", { dealId, contactId: existing.contactId ?? undefined, data: { fromStatus, lostReason: reason } }).catch(() => {});
        return NextResponse.json(deal);
      }
      const deal = await reopenDeal(dealId);
      createDealEvent(dealId, uid, "STATUS_CHANGED", { from: fromStatus, to: "OPEN" }).catch(() => {});
      return NextResponse.json(deal);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "INVALID_LOST_REASON") {
        return NextResponse.json({ message: "Motivo da perda inválido." }, { status: 400 });
      }
      throw err;
    }
  } catch (e: unknown) {
    console.error(e);
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2025") {
      return NextResponse.json({ message: "Negócio não encontrado." }, { status: 404 });
    }
    return NextResponse.json({ message: "Erro ao alterar status do negócio." }, { status: 500 });
  }
}
