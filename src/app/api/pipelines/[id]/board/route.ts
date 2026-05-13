import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getVisibilityFilter } from "@/lib/visibility";
import { getBoardData, isValidDealStatus } from "@/services/deals";
import { getPipelineMeta } from "@/services/pipelines";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
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

    const user = session.user as { id: string; role: "ADMIN" | "MANAGER" | "MEMBER" };
    const visibility = await getVisibilityFilter(user);
    const visibilityOwnerId = visibility.canSeeAll ? null : user.id;

    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const statusFilter = statusParam === "ALL"
      ? "ALL" as const
      : (statusParam && isValidDealStatus(statusParam) ? statusParam : undefined);

    const board = await getBoardData(pipelineId, visibilityOwnerId, statusFilter);
    return NextResponse.json(board);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao carregar quadro." }, { status: 500 });
  }
}
