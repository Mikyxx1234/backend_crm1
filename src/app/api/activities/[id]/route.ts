import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { deleteActivity, getActivityById, isValidActivityType, updateActivity } from "@/services/activities";
import { createDealEvent } from "@/services/deals";

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

    const activity = await getActivityById(id);
    if (!activity) {
      return NextResponse.json({ message: "Atividade não encontrada." }, { status: 404 });
    }

    return NextResponse.json(activity);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao buscar atividade." }, { status: 500 });
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

    const existing = await getActivityById(id);
    if (!existing) {
      return NextResponse.json({ message: "Atividade não encontrada." }, { status: 404 });
    }

    if (b.type !== undefined && (typeof b.type !== "string" || !isValidActivityType(b.type))) {
      return NextResponse.json({ message: "Tipo de atividade inválido." }, { status: 400 });
    }
    if (b.title !== undefined && (typeof b.title !== "string" || b.title.trim().length < 1)) {
      return NextResponse.json({ message: "Título inválido." }, { status: 400 });
    }
    if (b.completed !== undefined && typeof b.completed !== "boolean") {
      return NextResponse.json({ message: "completed inválido." }, { status: 400 });
    }

    let scheduledAt: Date | string | null | undefined;
    if (b.scheduledAt === null) {
      scheduledAt = null;
    } else if (typeof b.scheduledAt === "string") {
      const d = new Date(b.scheduledAt);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ message: "scheduledAt inválido." }, { status: 400 });
      }
      scheduledAt = d;
    } else if (b.scheduledAt !== undefined) {
      return NextResponse.json({ message: "scheduledAt inválido." }, { status: 400 });
    }

    let completedAt: Date | string | null | undefined;
    if (b.completedAt === null) {
      completedAt = null;
    } else if (typeof b.completedAt === "string") {
      const d = new Date(b.completedAt);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ message: "completedAt inválido." }, { status: 400 });
      }
      completedAt = d;
    } else if (b.completedAt !== undefined) {
      return NextResponse.json({ message: "completedAt inválido." }, { status: 400 });
    }

    const data = {
      type: typeof b.type === "string" && isValidActivityType(b.type) ? b.type : undefined,
      title: typeof b.title === "string" ? b.title : undefined,
      description:
        b.description === null
          ? null
          : typeof b.description === "string"
            ? b.description
            : undefined,
      completed: typeof b.completed === "boolean" ? b.completed : undefined,
      scheduledAt,
      completedAt,
      contactId:
        b.contactId === null
          ? null
          : typeof b.contactId === "string"
            ? b.contactId
            : undefined,
      dealId:
        b.dealId === null ? null : typeof b.dealId === "string" ? b.dealId : undefined,
    };

    const payload = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined)
    ) as Parameters<typeof updateActivity>[1];

    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ message: "Nenhum campo para atualizar." }, { status: 400 });
    }

    try {
      const activity = await updateActivity(id, payload);

      const targetDealId = typeof b.dealId === "string" ? b.dealId : existing.dealId;
      const uid = session.user.id as string;

      if (targetDealId && b.completed === true && !existing.completed) {
        createDealEvent(targetDealId, uid, "ACTIVITY_COMPLETED", {
          title: activity.title,
          activityType: activity.type,
        }).catch(() => {});
      } else if (targetDealId) {
        // Log ACTIVITY_UPDATED para qualquer outra edição (título,
        // descrição, tipo, scheduledAt, etc.). Ignora quando a única
        // mudança foi concluir (já coberto acima).
        const fieldsChanged: string[] = [];
        if (typeof b.title === "string" && b.title !== existing.title) fieldsChanged.push("title");
        if (typeof b.type === "string" && b.type !== existing.type) fieldsChanged.push("type");
        if (typeof b.description === "string" && b.description !== existing.description) fieldsChanged.push("description");
        if (b.scheduledAt !== undefined) fieldsChanged.push("scheduledAt");

        if (fieldsChanged.length > 0) {
          createDealEvent(targetDealId, uid, "ACTIVITY_UPDATED", {
            title: activity.title,
            activityType: activity.type,
            fields: fieldsChanged,
          }).catch(() => {});
        }
      }

      return NextResponse.json(activity);
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message === "INVALID_TITLE") {
          return NextResponse.json({ message: "Título inválido." }, { status: 400 });
        }
        if (err.message === "EMPTY_UPDATE") {
          return NextResponse.json({ message: "Nenhum campo para atualizar." }, { status: 400 });
        }
      }
      throw err;
    }
  } catch (e: unknown) {
    console.error(e);
    if (typeof e === "object" && e !== null && "code" in e) {
      const code = (e as { code: string }).code;
      if (code === "P2025") {
        return NextResponse.json({ message: "Atividade não encontrada." }, { status: 404 });
      }
      if (code === "P2003") {
        return NextResponse.json({ message: "Referência inválida." }, { status: 400 });
      }
    }
    return NextResponse.json({ message: "Erro ao atualizar atividade." }, { status: 500 });
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

    const existing = await getActivityById(id);
    if (!existing) {
      return NextResponse.json({ message: "Atividade não encontrada." }, { status: 404 });
    }

    await deleteActivity(id);

    if (existing.dealId) {
      const uid = session.user.id as string;
      createDealEvent(existing.dealId, uid, "ACTIVITY_DELETED", {
        title: existing.title,
        activityType: existing.type,
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    console.error(e);
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2025") {
      return NextResponse.json({ message: "Atividade não encontrada." }, { status: 404 });
    }
    return NextResponse.json({ message: "Erro ao excluir atividade." }, { status: 500 });
  }
}
