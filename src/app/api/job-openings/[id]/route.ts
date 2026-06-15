import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";
import { getPoolStats } from "@/services/inventory";

type RouteContext = { params: Promise<{ id: string }> };

const STATUSES = new Set(["OPEN", "PAUSED", "FILLED", "CLOSED"]);

export async function GET(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "job_opening:view");
    if (denied) return denied;

    const { id } = await context.params;
    const job = await prisma.jobOpening.findUnique({
      where: { id },
      include: {
        clientCompany: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
        stakeholders: {
          include: { contact: { select: { id: true, name: true, email: true, phone: true } } },
        },
      },
    });
    if (!job) {
      return NextResponse.json({ message: "Vaga não encontrada." }, { status: 404 });
    }
    const stats = await getPoolStats(job.poolId);
    return NextResponse.json({ jobOpening: { ...job, stats } });
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const { id } = await context.params;
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    // Fechar a vaga exige permissão dedicada; demais edições -> manage.
    const wantsClose =
      typeof body.status === "string" &&
      ["CLOSED", "FILLED"].includes(body.status.toUpperCase());
    const denied = await requirePermissionForUser(
      authResult.user,
      wantsClose ? "job_opening:close" : "job_opening:manage",
    );
    if (denied) return denied;

    const data: Record<string, unknown> = {};
    if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
    if (typeof body.status === "string" && STATUSES.has(body.status.toUpperCase())) {
      data.status = body.status.toUpperCase();
    }
    for (const key of [
      "candidatePipelineId",
      "reserveStageId",
      "consumeStageId",
      "b2bDealId",
    ] as const) {
      if (body[key] === null || typeof body[key] === "string") {
        data[key] = (body[key] as string | null) || null;
      }
    }

    try {
      const jobOpening = await prisma.jobOpening.update({ where: { id }, data });
      return NextResponse.json({ jobOpening });
    } catch {
      return NextResponse.json({ message: "Vaga não encontrada." }, { status: 404 });
    }
  });
}
