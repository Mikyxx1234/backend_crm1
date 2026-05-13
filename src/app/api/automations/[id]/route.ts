import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { deleteAutomation, getAutomationById, updateAutomation } from "@/services/automations";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ message: "ID inválido." }, { status: 400 });
    }

    const automation = await getAutomationById(id);
    if (!automation) {
      return NextResponse.json({ message: "Automação não encontrada." }, { status: 404 });
    }

    return NextResponse.json(automation);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao buscar automação." }, { status: 500 });
  }
}

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

    const existing = await getAutomationById(id);
    if (!existing) {
      return NextResponse.json({ message: "Automação não encontrada." }, { status: 404 });
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

    if (b.steps !== undefined) {
      if (!Array.isArray(b.steps)) {
        return NextResponse.json({ message: "steps deve ser um array." }, { status: 400 });
      }
      for (const step of b.steps) {
        if (!step || typeof step !== "object") {
          return NextResponse.json({ message: "Passo de automação inválido." }, { status: 400 });
        }
        const s = step as Record<string, unknown>;
        if (typeof s.type !== "string" || !s.type.trim()) {
          return NextResponse.json({ message: "Cada passo precisa de type." }, { status: 400 });
        }
        if (s.config === undefined) {
          return NextResponse.json({ message: "Cada passo precisa de config." }, { status: 400 });
        }
      }
    }

    const payload: Parameters<typeof updateAutomation>[1] = {};

    if (typeof b.name === "string") payload.name = b.name;
    if (b.description !== undefined) {
      payload.description =
        b.description === null ? null : typeof b.description === "string" ? b.description : undefined;
    }
    if (typeof b.triggerType === "string") payload.triggerType = b.triggerType;
    if (b.triggerConfig !== undefined) {
      payload.triggerConfig = b.triggerConfig as Parameters<typeof updateAutomation>[1]["triggerConfig"];
    }
    if (typeof b.active === "boolean") payload.active = b.active;
    if (Array.isArray(b.steps)) {
      payload.steps = (b.steps as { id?: string; type: string; config: unknown }[]).map((s) => ({
        id: typeof s.id === "string" ? s.id : undefined,
        type: s.type,
        config: s.config as NonNullable<Parameters<typeof updateAutomation>[1]["steps"]>[number]["config"],
      }));
    }

    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ message: "Nenhum campo para atualizar." }, { status: 400 });
    }

    try {
      const automation = await updateAutomation(id, payload);
      return NextResponse.json(automation);
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message === "NOT_FOUND") {
          return NextResponse.json({ message: "Automação não encontrada." }, { status: 404 });
        }
        if (err.message === "INVALID_NAME") {
          return NextResponse.json({ message: "Nome inválido." }, { status: 400 });
        }
      }
      throw err;
    }
  } catch (e: unknown) {
    console.error(e);
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2025") {
      return NextResponse.json({ message: "Automação não encontrada." }, { status: 404 });
    }
    return NextResponse.json({ message: "Erro ao atualizar automação." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ message: "ID inválido." }, { status: 400 });
    }

    const existing = await getAutomationById(id);
    if (!existing) {
      return NextResponse.json({ message: "Automação não encontrada." }, { status: 404 });
    }

    await deleteAutomation(id);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    console.error(e);
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2025") {
      return NextResponse.json({ message: "Automação não encontrada." }, { status: 404 });
    }
    return NextResponse.json({ message: "Erro ao excluir automação." }, { status: 500 });
  }
}
