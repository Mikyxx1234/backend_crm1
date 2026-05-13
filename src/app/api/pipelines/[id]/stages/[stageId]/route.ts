import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { deleteStage, getStageInPipeline, updateStage } from "@/services/pipelines";

type RouteContext = { params: Promise<{ id: string; stageId: string }> };

export async function PUT(request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { id: pipelineId, stageId } = await context.params;
    if (!pipelineId || !stageId) {
      return NextResponse.json({ message: "ID inválido." }, { status: 400 });
    }

    const stageRow = await getStageInPipeline(pipelineId, stageId);
    if (!stageRow) {
      return NextResponse.json({ message: "Estágio não encontrado." }, { status: 404 });
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

    if (b.name !== undefined && (typeof b.name !== "string" || b.name.trim().length < 1)) {
      return NextResponse.json({ message: "Nome inválido." }, { status: 400 });
    }
    if (b.color !== undefined && typeof b.color !== "string") {
      return NextResponse.json({ message: "Cor inválida." }, { status: 400 });
    }
    if (b.winProbability !== undefined) {
      if (typeof b.winProbability !== "number" || !Number.isFinite(b.winProbability)) {
        return NextResponse.json({ message: "winProbability inválido." }, { status: 400 });
      }
    }
    if (b.rottingDays !== undefined) {
      if (typeof b.rottingDays !== "number" || !Number.isInteger(b.rottingDays)) {
        return NextResponse.json({ message: "rottingDays inválido." }, { status: 400 });
      }
    }
    if (b.position !== undefined) {
      if (typeof b.position !== "number" || !Number.isInteger(b.position) || b.position < 0) {
        return NextResponse.json({ message: "position inválido." }, { status: 400 });
      }
    }

    const hasField =
      b.name !== undefined ||
      b.color !== undefined ||
      b.winProbability !== undefined ||
      b.rottingDays !== undefined ||
      b.position !== undefined;
    if (!hasField) {
      return NextResponse.json({ message: "Nenhum campo para atualizar." }, { status: 400 });
    }

    try {
      const stage = await updateStage(stageId, {
        name: typeof b.name === "string" ? b.name : undefined,
        color: typeof b.color === "string" ? b.color : undefined,
        winProbability: typeof b.winProbability === "number" ? b.winProbability : undefined,
        rottingDays: typeof b.rottingDays === "number" ? b.rottingDays : undefined,
        position: typeof b.position === "number" ? b.position : undefined,
      });
      return NextResponse.json(stage);
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message === "INVALID_NAME") {
          return NextResponse.json({ message: "Nome inválido." }, { status: 400 });
        }
        if (err.message === "EMPTY_UPDATE") {
          return NextResponse.json({ message: "Nenhum campo para atualizar." }, { status: 400 });
        }
        if (err.message === "NOT_FOUND") {
          return NextResponse.json({ message: "Estágio não encontrado." }, { status: 404 });
        }
        if (err.message === "INVALID_STAGE_ORDER") {
          return NextResponse.json(
            { message: "Ordem de estágios inválida ou incompleta." },
            { status: 400 }
          );
        }
      }
      throw err;
    }
  } catch (e: unknown) {
    console.error(e);
    if (typeof e === "object" && e !== null && "code" in e) {
      const code = (e as { code: string }).code;
      if (code === "P2025") {
        return NextResponse.json({ message: "Estágio não encontrado." }, { status: 404 });
      }
      if (code === "P2002") {
        return NextResponse.json({ message: "Conflito de posição entre estágios." }, { status: 409 });
      }
    }
    return NextResponse.json({ message: "Erro ao atualizar estágio." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { id: pipelineId, stageId } = await context.params;
    if (!pipelineId || !stageId) {
      return NextResponse.json({ message: "ID inválido." }, { status: 400 });
    }

    const stageRow = await getStageInPipeline(pipelineId, stageId);
    if (!stageRow) {
      return NextResponse.json({ message: "Estágio não encontrado." }, { status: 404 });
    }

    try {
      await deleteStage(stageId);
      return NextResponse.json({ ok: true });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "STAGE_HAS_DEALS") {
        return NextResponse.json(
          { message: "Não é possível excluir: existem negócios neste estágio." },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (e: unknown) {
    console.error(e);
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2025") {
      return NextResponse.json({ message: "Estágio não encontrado." }, { status: 404 });
    }
    return NextResponse.json({ message: "Erro ao excluir estágio." }, { status: 500 });
  }
}
