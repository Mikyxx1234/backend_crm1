import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import {
  getPipelineLossReasonMeta,
  setPipelineLossReasonRequired,
  setPipelineLossReasons,
} from "@/services/loss-reasons";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return withOrgContext(async () => {
    try {
      const { id } = await ctx.params;
      const meta = await getPipelineLossReasonMeta(id);
      if (!meta) {
        return NextResponse.json({ message: "Funil não encontrado." }, { status: 404 });
      }
      return NextResponse.json(meta);
    } catch (e) {
      console.error(e);
      return NextResponse.json({ message: "Erro ao listar motivos do funil." }, { status: 500 });
    }
  });
}

/**
 * Body:
 *  - { reasonIds: string[] } — substitui vínculos + ordem
 *  - { lossReasonRequired: boolean } — toggle obrigatoriedade
 *  - ambos no mesmo request ok
 */
export async function PUT(request: Request, ctx: Ctx) {
  return withOrgContext(async () => {
    try {
      const { id } = await ctx.params;
      const body = (await request.json()) as Record<string, unknown>;

      if (typeof body.lossReasonRequired === "boolean") {
        await setPipelineLossReasonRequired(id, body.lossReasonRequired);
      }

      if (Array.isArray(body.reasonIds)) {
        const reasonIds = body.reasonIds.filter((x): x is string => typeof x === "string");
        await setPipelineLossReasons(id, reasonIds);
      }

      const meta = await getPipelineLossReasonMeta(id);
      if (!meta) {
        return NextResponse.json({ message: "Funil não encontrado." }, { status: 404 });
      }
      return NextResponse.json(meta);
    } catch (e) {
      if (e instanceof Error && e.message === "PIPELINE_NOT_FOUND") {
        return NextResponse.json({ message: "Funil não encontrado." }, { status: 404 });
      }
      if (e instanceof Error && e.message === "INVALID_REASON") {
        return NextResponse.json({ message: "Motivo inválido." }, { status: 400 });
      }
      console.error(e);
      return NextResponse.json({ message: "Erro ao salvar motivos do funil." }, { status: 500 });
    }
  });
}
