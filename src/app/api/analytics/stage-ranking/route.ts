import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Ranking de agentes por etapa do funil.
 *
 * Para cada `Stage` do pipeline pedido, retorna a lista de owners com:
 *   - `count`: número de deals (OPEN) que o owner tem nessa etapa
 *   - `value`: soma do `value` desses deals
 *
 * Se `from`/`to` vierem, consideramos apenas deals criados no intervalo
 * (`createdAt` do Deal). Caso contrário, **todos** os deals abertos.
 *
 * A UI decide exibir por count ou por value (toggle).
 *
 * Query params:
 *   - pipelineId (obrigatório)
 *   - from (ISO, opcional)
 *   - to   (ISO, opcional)
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const url = new URL(req.url);
  const pipelineId = url.searchParams.get("pipelineId");
  if (!pipelineId) {
    return NextResponse.json(
      { message: "Query param 'pipelineId' é obrigatório." },
      { status: 400 },
    );
  }

  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const from = fromParam ? new Date(fromParam) : null;
  const to = toParam ? new Date(toParam) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    return NextResponse.json(
      { message: "Datas 'from'/'to' inválidas." },
      { status: 400 },
    );
  }

  const stages = await prisma.stage.findMany({
    where: { pipelineId },
    orderBy: { position: "asc" },
    select: { id: true, name: true, color: true, position: true },
  });

  if (stages.length === 0) {
    return NextResponse.json({ pipelineId, stages: [] });
  }

  const deals = await prisma.deal.findMany({
    where: {
      stage: { pipelineId },
      status: "OPEN",
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      ownerId: { not: null },
    },
    select: { id: true, stageId: true, ownerId: true, value: true },
  });

  const ownerIds = Array.from(
    new Set(deals.map((d) => d.ownerId).filter((v): v is string => Boolean(v))),
  );
  const owners = await prisma.user.findMany({
    where: { id: { in: ownerIds } },
    select: { id: true, name: true, avatarUrl: true },
  });
  const ownerMap = new Map(owners.map((o) => [o.id, o]));

  // Agregação em memória: { stageId -> { ownerId -> { count, value } } }
  type AgentRow = { userId: string; name: string; avatarUrl: string | null; count: number; value: number };
  const byStage = new Map<string, Map<string, AgentRow>>();

  for (const deal of deals) {
    if (!deal.ownerId) continue;
    const owner = ownerMap.get(deal.ownerId);
    if (!owner) continue;

    const stageMap = byStage.get(deal.stageId) ?? new Map<string, AgentRow>();
    const row =
      stageMap.get(deal.ownerId) ?? {
        userId: deal.ownerId,
        name: owner.name,
        avatarUrl: owner.avatarUrl,
        count: 0,
        value: 0,
      };
    row.count += 1;
    row.value += Number(deal.value ?? 0);
    stageMap.set(deal.ownerId, row);
    byStage.set(deal.stageId, stageMap);
  }

  const result = stages.map((stage) => {
    const agentsMap = byStage.get(stage.id) ?? new Map<string, AgentRow>();
    const agents = Array.from(agentsMap.values()).sort(
      (a, b) => b.count - a.count || b.value - a.value,
    );
    const totals = agents.reduce(
      (acc, a) => ({ count: acc.count + a.count, value: acc.value + a.value }),
      { count: 0, value: 0 },
    );
    return {
      stageId: stage.id,
      stageName: stage.name,
      stageColor: stage.color,
      stagePosition: stage.position,
      totalCount: totals.count,
      totalValue: totals.value,
      agents,
    };
  });

  return NextResponse.json({ pipelineId, stages: result });
}
