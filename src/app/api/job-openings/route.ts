import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { getPoolStats, restock } from "@/services/inventory";

export async function GET(request: Request) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "job_opening:view");
    if (denied) return denied;

    const url = new URL(request.url);
    const status = url.searchParams.get("status")?.toUpperCase();
    const jobs = await prisma.jobOpening.findMany({
      where: status ? { status: status as never } : {},
      include: {
        clientCompany: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const withStats = await Promise.all(
      jobs.map(async (j) => ({
        ...j,
        stats: await getPoolStats(j.poolId),
      })),
    );
    return NextResponse.json({ jobOpenings: withStats });
  });
}

export async function POST(request: Request) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "job_opening:manage");
    if (denied) return denied;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ message: "Título é obrigatório." }, { status: 400 });
    }
    const clientCompanyId =
      typeof body.clientCompanyId === "string" ? body.clientCompanyId : "";
    if (!clientCompanyId) {
      return NextResponse.json(
        { message: "clientCompanyId (empresa cliente) é obrigatório." },
        { status: 400 },
      );
    }
    const vacancies = Math.max(0, Math.floor(Number(body.vacancies) || 0));

    const productId =
      typeof body.productId === "string" && body.productId ? body.productId : null;

    // Cada vaga tem um pool próprio (vagas). Repõe a alocação inicial.
    const pool = await prisma.inventoryPool.create({
      data: withOrgFromCtx({
        productId,
        consumeTrigger: "MANUAL" as never,
        allowNegative: false,
      }),
      select: { id: true },
    });
    if (vacancies > 0) {
      await restock({ poolId: pool.id, qty: vacancies, note: `Vagas iniciais: ${title}` });
    }

    const job = await prisma.jobOpening.create({
      data: withOrgFromCtx({
        productId,
        clientCompanyId,
        title,
        b2bDealId: typeof body.b2bDealId === "string" && body.b2bDealId ? body.b2bDealId : null,
        candidatePipelineId:
          typeof body.candidatePipelineId === "string" && body.candidatePipelineId
            ? body.candidatePipelineId
            : null,
        poolId: pool.id,
        reserveStageId:
          typeof body.reserveStageId === "string" && body.reserveStageId
            ? body.reserveStageId
            : null,
        consumeStageId:
          typeof body.consumeStageId === "string" && body.consumeStageId
            ? body.consumeStageId
            : null,
        status: "OPEN",
      }),
    });
    return NextResponse.json({ jobOpening: job }, { status: 201 });
  });
}
