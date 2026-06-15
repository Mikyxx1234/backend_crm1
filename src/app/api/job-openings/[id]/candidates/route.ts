import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Lista os candidatos (deals do funil B2C) de uma vaga. Os candidatos vivem
 * no `candidatePipelineId` da vaga — retornamos os deals desse pipeline com
 * seu estágio atual (para a visão de progresso/timeline).
 */
export async function GET(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "job_opening:view");
    if (denied) return denied;

    const { id } = await context.params;
    const job = await prisma.jobOpening.findUnique({
      where: { id },
      select: { candidatePipelineId: true },
    });
    if (!job) {
      return NextResponse.json({ message: "Vaga não encontrada." }, { status: 404 });
    }
    if (!job.candidatePipelineId) {
      return NextResponse.json({ candidates: [] });
    }

    const candidates = await prisma.deal.findMany({
      where: { stage: { pipelineId: job.candidatePipelineId } },
      include: {
        contact: { select: { id: true, name: true, email: true, phone: true } },
        stage: { select: { id: true, name: true, isWon: true, isLost: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ candidates });
  });
}
