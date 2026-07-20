import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getTree } from "@/services/tabulations";

/**
 * Rota de leitura para agentes (nao exige role ADMIN/MANAGER — soh
 * autenticacao). Usada pelo modal de tabulacao no encerramento e por
 * qualquer UI que precise mostrar a arvore de um departamento.
 *
 * GET /api/tabulations?departmentId=xxx
 *   → { departmentId, requireTabulationOnClose, tree: TabulationNode[] }
 */
export async function GET(request: Request) {
  return withOrgContext(async () => {
    const url = new URL(request.url);
    const departmentId = url.searchParams.get("departmentId")?.trim();
    if (!departmentId) {
      return NextResponse.json(
        { message: "departmentId eh obrigatorio." },
        { status: 400 },
      );
    }
    const dept = await prisma.department.findFirst({
      where: { id: departmentId },
      select: { id: true, requireTabulationOnClose: true },
    });
    if (!dept) {
      return NextResponse.json(
        { message: "Departamento nao encontrado." },
        { status: 404 },
      );
    }
    const tree = await getTree(departmentId);
    return NextResponse.json({
      departmentId,
      requireTabulationOnClose: dept.requireTabulationOnClose,
      tree,
    });
  });
}
