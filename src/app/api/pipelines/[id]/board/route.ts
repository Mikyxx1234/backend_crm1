import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { getVisibilityFilter } from "@/lib/visibility";
import { getBoardData, isValidDealStatus } from "@/services/deals";
import { getPipelineMeta } from "@/services/pipelines";

type RouteContext = { params: Promise<{ id: string }> };

// Bug 24/abr/26: usavamos `auth()` direto. As chamadas getPipelineMeta /
// getVisibilityFilter / getBoardData rodam queries Prisma e dependem da
// extension multi-tenant pra resolver organizationId no where. Sem o
// AsyncLocalStorage scope ativo o handler estourava com
// `getOrgIdOrThrow: organization context ausente`, e o front renderizava
// "Erro ao carregar quadro." em /pipeline. withOrgContext envolve o
// handler em runWithContext.
export async function GET(request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    try {
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
  });
}
