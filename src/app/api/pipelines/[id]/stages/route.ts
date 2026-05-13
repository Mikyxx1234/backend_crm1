import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { createStage, getPipelineMeta, reorderStages } from "@/services/pipelines";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { id: pipelineId } = await context.params;
    if (!pipelineId) {
      return NextResponse.json({ message: "ID inválido." }, { status: 400 });
    }

    const meta = await getPipelineMeta(pipelineId);
    if (!meta) {
      return NextResponse.json({ message: "Pipeline não encontrado." }, { status: 404 });
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
    if (typeof b.name !== "string" || b.name.trim().length < 1) {
      return NextResponse.json({ message: "Nome é obrigatório." }, { status: 400 });
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

    try {
      const stage = await createStage(pipelineId, {
        name: b.name,
        color: typeof b.color === "string" ? b.color : undefined,
        winProbability: typeof b.winProbability === "number" ? b.winProbability : undefined,
        rottingDays: typeof b.rottingDays === "number" ? b.rottingDays : undefined,
        position: typeof b.position === "number" ? b.position : undefined,
      });
      return NextResponse.json(stage, { status: 201 });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "INVALID_NAME") {
        return NextResponse.json({ message: "Nome inválido." }, { status: 400 });
      }
      throw err;
    }
  } catch (e: unknown) {
    console.error(e);
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2003") {
      return NextResponse.json({ message: "Referência inválida." }, { status: 400 });
    }
    return NextResponse.json({ message: "Erro ao criar estágio." }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { id: pipelineId } = await context.params;
    if (!pipelineId) {
      return NextResponse.json({ message: "ID inválido." }, { status: 400 });
    }

    const meta = await getPipelineMeta(pipelineId);
    if (!meta) {
      return NextResponse.json({ message: "Pipeline não encontrado." }, { status: 404 });
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
    if (!Array.isArray(b.stageIds) || b.stageIds.some((x) => typeof x !== "string")) {
      return NextResponse.json({ message: "stageIds deve ser um array de strings." }, { status: 400 });
    }

    try {
      await reorderStages(pipelineId, b.stageIds as string[]);
      return NextResponse.json({ ok: true });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "INVALID_STAGE_ORDER") {
        return NextResponse.json(
          { message: "Ordem de estágios inválida ou incompleta." },
          { status: 400 }
        );
      }
      throw err;
    }
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao reordenar estágios." }, { status: 500 });
  }
}
