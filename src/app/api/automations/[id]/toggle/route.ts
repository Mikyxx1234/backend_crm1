import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getAutomationById, toggleAutomation } from "@/services/automations";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
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

    try {
      const automation = await toggleAutomation(id);
      return NextResponse.json(automation);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "NOT_FOUND") {
        return NextResponse.json({ message: "Automação não encontrada." }, { status: 404 });
      }
      throw err;
    }
  } catch (e: unknown) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao alternar automação." }, { status: 500 });
  }
}
