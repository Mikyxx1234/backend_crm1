import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { getAutomationById, getAutomationLogs } from "@/services/automations";

type RouteContext = { params: Promise<{ id: string }> };

function parseIntParam(v: string | null, fallback: number) {
  if (v === null || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(request: Request, context: RouteContext) {
  return withOrgContext(async () => {
    try {
      const { id } = await context.params;
      if (!id) {
        return NextResponse.json({ message: "ID inválido." }, { status: 400 });
      }

      const automation = await getAutomationById(id);
      if (!automation) {
        return NextResponse.json({ message: "Automação não encontrada." }, { status: 404 });
      }

      const { searchParams } = new URL(request.url);
      const page = parseIntParam(searchParams.get("page"), 1);
      const perPage = parseIntParam(searchParams.get("perPage"), 20);
      const stepId = searchParams.get("stepId") ?? undefined;

      const result = await getAutomationLogs(id, { page, perPage, stepId });
      return NextResponse.json(result);
    } catch (e) {
      console.error(e);
      return NextResponse.json({ message: "Erro ao listar logs da automação." }, { status: 500 });
    }
  });
}
