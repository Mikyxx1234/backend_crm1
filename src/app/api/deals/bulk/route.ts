import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fireTrigger } from "@/services/automation-triggers";
import { assignDealOwner, createDealEvent } from "@/services/deals";

const VALID_ACTIONS = ["move_stage", "change_owner", "mark_won", "mark_lost", "delete"] as const;
type BulkAction = (typeof VALID_ACTIONS)[number];

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });

    const body = (await request.json()) as Record<string, unknown>;
    const dealIds = Array.isArray(body.dealIds) ? (body.dealIds as string[]).filter((id) => typeof id === "string") : [];
    const action = body.action as BulkAction;

    if (dealIds.length === 0) return NextResponse.json({ message: "Nenhum deal selecionado." }, { status: 400 });
    if (!VALID_ACTIONS.includes(action)) return NextResponse.json({ message: "Ação inválida." }, { status: 400 });

    const uid = (session.user as { id: string }).id;
    let affected = 0;

    if (action === "move_stage") {
      const stageId = typeof body.stageId === "string" ? body.stageId : "";
      if (!stageId) return NextResponse.json({ message: "stageId é obrigatório." }, { status: 400 });

      const stage = await prisma.stage.findUnique({ where: { id: stageId }, select: { id: true, name: true } });
      if (!stage) return NextResponse.json({ message: "Etapa não encontrada." }, { status: 404 });

      const deals = await prisma.deal.findMany({
        where: { id: { in: dealIds } },
        select: { id: true, stageId: true, stage: { select: { name: true } } },
      });

      for (const deal of deals) {
        if (deal.stageId !== stageId) {
          await prisma.deal.update({ where: { id: deal.id }, data: { stageId } });
          createDealEvent(deal.id, uid, "STAGE_CHANGED", {
            from: { id: deal.stageId, name: deal.stage.name },
            to: { id: stage.id, name: stage.name },
          }).catch(() => {});
          fireTrigger("stage_changed", {
            dealId: deal.id,
            data: { fromStageId: deal.stageId, toStageId: stageId },
          }).catch(() => {});
          affected++;
        }
      }
    }

    if (action === "change_owner") {
      const ownerId = body.ownerId === null ? null : typeof body.ownerId === "string" ? body.ownerId : undefined;
      if (ownerId === undefined) return NextResponse.json({ message: "ownerId é obrigatório." }, { status: 400 });

      const ownerName = ownerId
        ? (await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } }))?.name ?? ownerId
        : null;

      const deals = await prisma.deal.findMany({
        where: { id: { in: dealIds } },
        select: { id: true, ownerId: true, owner: { select: { name: true } } },
      });

      for (const deal of deals) {
        if (deal.ownerId !== ownerId) {
          // Usa helper centralizado — propaga assignee para o
          // contato e conversas (regra de responsável único).
          await assignDealOwner(deal.id, ownerId);
          createDealEvent(deal.id, uid, "OWNER_CHANGED", {
            from: deal.ownerId ? { id: deal.ownerId, name: deal.owner?.name ?? "" } : null,
            to: ownerId ? { id: ownerId, name: ownerName } : null,
          }).catch(() => {});
          affected++;
        }
      }
    }

    if (action === "mark_won") {
      const result = await prisma.deal.updateMany({
        where: { id: { in: dealIds }, status: { not: "WON" } },
        data: { status: "WON", closedAt: new Date() },
      });
      affected = result.count;
      for (const id of dealIds) {
        createDealEvent(id, uid, "STATUS_CHANGED", { from: "OPEN", to: "WON" }).catch(() => {});
        fireTrigger("deal_won", { dealId: id, data: { fromStatus: "OPEN" } }).catch(() => {});
      }
    }

    if (action === "mark_lost") {
      const lostReason = typeof body.lostReason === "string" ? body.lostReason.trim() : "";

      const requireSetting = await prisma.systemSetting.findUnique({ where: { key: "loss_reason_required" } });
      if (requireSetting?.value === "true" && !lostReason) {
        return NextResponse.json({ message: "Motivo da perda é obrigatório." }, { status: 400 });
      }

      const result = await prisma.deal.updateMany({
        where: { id: { in: dealIds }, status: { not: "LOST" } },
        data: { status: "LOST", closedAt: new Date(), lostReason: lostReason || null },
      });
      affected = result.count;
      for (const id of dealIds) {
        createDealEvent(id, uid, "STATUS_CHANGED", { from: "OPEN", to: "LOST", lostReason }).catch(() => {});
        fireTrigger("deal_lost", { dealId: id, data: { fromStatus: "OPEN", lostReason } }).catch(() => {});
      }
    }

    if (action === "delete") {
      const result = await prisma.deal.deleteMany({ where: { id: { in: dealIds } } });
      affected = result.count;
    }

    return NextResponse.json({ affected, action });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro na ação em massa." }, { status: 500 });
  }
}
