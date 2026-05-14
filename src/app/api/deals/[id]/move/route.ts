import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { requirePermissionForUser, requireStageScope } from "@/lib/authz/resource-policy";
import { fireTrigger } from "@/services/automation-triggers";
import { createDealEvent, getDealById, moveDeal } from "@/services/deals";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    try {
      const denied = await requirePermissionForUser(
        session.user as { id: string; organizationId: string | null; role?: string | null; isSuperAdmin?: boolean },
        "deal:change_stage",
      );
      if (denied) return denied;

      const { id } = await context.params;
      if (!id) {
        return NextResponse.json({ message: "ID inválido." }, { status: 400 });
      }

      const existing = await getDealById(id);
      if (!existing) {
        return NextResponse.json({ message: "Negócio não encontrado." }, { status: 404 });
      }

      const dealId = existing.id;

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
      if (typeof b.stageId !== "string" || !b.stageId) {
        return NextResponse.json({ message: "stageId é obrigatório." }, { status: 400 });
      }
      const stageDenied = await requireStageScope(
        session.user as { id: string; organizationId: string | null; role?: string | null; isSuperAdmin?: boolean },
        "move",
        b.stageId,
      );
      if (stageDenied) return stageDenied;
      if (typeof b.position !== "number" || !Number.isInteger(b.position) || b.position < 0) {
        return NextResponse.json({ message: "position inválido." }, { status: 400 });
      }

      try {
        const fromStage = { id: existing.stage.id, name: existing.stage.name };
        const deal = await moveDeal(dealId, b.stageId, b.position);
        if (!deal) {
          return NextResponse.json({ message: "Negócio não encontrado." }, { status: 404 });
        }

        if (b.stageId !== fromStage.id) {
          const uid = (session.user as { id: string }).id;
          const toStage = (deal as { stage?: { id: string; name: string } }).stage;
          createDealEvent(dealId, uid, "STAGE_CHANGED", {
            from: fromStage,
            to: { id: b.stageId as string, name: toStage?.name ?? b.stageId },
          }).catch(() => {});

          fireTrigger("stage_changed", {
            dealId,
            contactId: existing.contactId ?? undefined,
            data: { fromStageId: fromStage.id, toStageId: b.stageId },
          }).catch(() => {});
        }

        return NextResponse.json(deal);
      } catch (err: unknown) {
        if (err instanceof Error) {
          if (err.message === "NOT_FOUND") {
            return NextResponse.json({ message: "Negócio não encontrado." }, { status: 404 });
          }
          if (err.message === "STAGE_NOT_FOUND") {
            return NextResponse.json({ message: "Estágio não encontrado." }, { status: 400 });
          }
          if (err.message === "CROSS_PIPELINE") {
            return NextResponse.json(
              { message: "O estágio de destino deve pertencer ao mesmo pipeline." },
              { status: 400 }
            );
          }
          if (err.message === "INVALID_POSITION") {
            return NextResponse.json({ message: "position inválido." }, { status: 400 });
          }
        }
        throw err;
      }
    } catch (e) {
      console.error(e);
      return NextResponse.json({ message: "Erro ao mover negócio." }, { status: 500 });
    }
  });
}
