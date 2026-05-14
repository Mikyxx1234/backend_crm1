import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { getAutomationById, toggleAutomation } from "@/services/automations";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  return withOrgContext(async () => {
    try {
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
  });
}
