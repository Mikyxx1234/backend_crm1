import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const DEFAULT_STAGES: Omit<Prisma.StageCreateWithoutPipelineInput, "pipeline">[] = [
  { name: "Novo", position: 0, color: "#6366f1", winProbability: 10, rottingDays: 30 },
  { name: "Qualificado", position: 1, color: "#8b5cf6", winProbability: 25, rottingDays: 30 },
  { name: "Proposta", position: 2, color: "#ec4899", winProbability: 50, rottingDays: 14 },
  { name: "Negociação", position: 3, color: "#f97316", winProbability: 75, rottingDays: 7 },
  { name: "Fechamento", position: 4, color: "#22c55e", winProbability: 90, rottingDays: 7 },
];

const stageWithCountSelect = {
  id: true,
  name: true,
  position: true,
  color: true,
  winProbability: true,
  rottingDays: true,
  isIncoming: true,
  pipelineId: true,
  _count: { select: { deals: true } },
} satisfies Prisma.StageSelect;

export async function ensureDefaultPipeline() {
  const count = await prisma.pipeline.count();
  if (count > 0) return;
  await prisma.pipeline.create({
    data: {
      name: "Pipeline Principal",
      isDefault: true,
      stages: {
        create: DEFAULT_STAGES.map((s) => ({ ...s })),
      },
    },
  });
}

export async function getPipelines() {
  await ensureDefaultPipeline();

  const pipelines = await prisma.pipeline.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      stages: {
        orderBy: { position: "asc" },
        select: stageWithCountSelect,
      },
    },
  });

  return pipelines.map((p) => ({
    ...p,
    stages: p.stages.map((s) => {
      const { _count, ...rest } = s;
      return { ...rest, dealCount: _count.deals };
    }),
  }));
}

const dealListInclude = {
  contact: { select: { id: true, name: true, email: true, phone: true, avatarUrl: true } },
  owner: { select: { id: true, name: true, email: true, avatarUrl: true } },
} satisfies Prisma.DealInclude;

export async function getPipelineMeta(id: string) {
  return prisma.pipeline.findUnique({
    where: { id },
    select: { id: true, name: true, isDefault: true },
  });
}

export async function getPipelineById(id: string) {
  const pipeline = await prisma.pipeline.findUnique({
    where: { id },
    include: {
      stages: {
        orderBy: { position: "asc" },
        include: {
          deals: {
            orderBy: { position: "asc" },
            include: dealListInclude,
          },
        },
      },
    },
  });
  return pipeline;
}

export async function createPipeline(data: { name: string }) {
  const name = data.name.trim();
  if (!name) {
    throw new Error("INVALID_NAME");
  }

  return prisma.pipeline.create({
    data: {
      name,
      stages: {
        create: DEFAULT_STAGES.map((s) => ({ ...s })),
      },
    },
    include: {
      stages: { orderBy: { position: "asc" } },
    },
  });
}

export type UpdatePipelineInput = {
  name?: string;
  isDefault?: boolean;
};

export async function updatePipeline(id: string, data: UpdatePipelineInput) {
  const payload: Prisma.PipelineUpdateInput = {};

  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw new Error("INVALID_NAME");
    payload.name = name;
  }
  if (data.isDefault !== undefined) {
    payload.isDefault = data.isDefault;
  }

  if (Object.keys(payload).length === 0) {
    throw new Error("EMPTY_UPDATE");
  }

  if (data.isDefault === true) {
    return prisma.$transaction(async (tx) => {
      await tx.pipeline.updateMany({
        where: { id: { not: id } },
        data: { isDefault: false },
      });
      return tx.pipeline.update({
        where: { id },
        data: payload,
        include: { stages: { orderBy: { position: "asc" } } },
      });
    });
  }

  return prisma.pipeline.update({
    where: { id },
    data: payload,
    include: { stages: { orderBy: { position: "asc" } } },
  });
}

export async function deletePipeline(id: string) {
  await prisma.pipeline.delete({ where: { id } });
}

export type CreateStageInput = {
  name: string;
  color?: string;
  winProbability?: number;
  rottingDays?: number;
  position?: number;
};

export async function createStage(pipelineId: string, data: CreateStageInput) {
  const name = data.name.trim();
  if (!name) throw new Error("INVALID_NAME");

  return prisma.$transaction(async (tx) => {
    const max = await tx.stage.aggregate({
      where: { pipelineId },
      _max: { position: true },
    });
    const maxPos = max._max.position ?? -1;
    const next = maxPos + 1;
    const position = data.position !== undefined ? data.position : next;

    if (data.position !== undefined && data.position < next) {
      await tx.stage.updateMany({
        where: { pipelineId, position: { gte: position } },
        data: { position: { increment: 1 } },
      });
    }

    return tx.stage.create({
      data: {
        name,
        position,
        pipelineId,
        color: data.color ?? "#6366f1",
        winProbability: data.winProbability ?? 0,
        rottingDays: data.rottingDays ?? 30,
      },
    });
  });
}

export type UpdateStageInput = {
  name?: string;
  color?: string;
  winProbability?: number;
  rottingDays?: number;
  position?: number;
};

export async function updateStage(id: string, data: UpdateStageInput) {
  const hasField =
    data.name !== undefined ||
    data.color !== undefined ||
    data.winProbability !== undefined ||
    data.rottingDays !== undefined ||
    data.position !== undefined;
  if (!hasField) throw new Error("EMPTY_UPDATE");

  const stage = await prisma.stage.findUnique({ where: { id } });
  if (!stage) throw new Error("NOT_FOUND");

  if (data.position !== undefined && data.position !== stage.position) {
    const stages = await prisma.stage.findMany({
      where: { pipelineId: stage.pipelineId },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    const ids = stages.map((s) => s.id);
    const from = ids.indexOf(id);
    if (from === -1) throw new Error("NOT_FOUND");
    ids.splice(from, 1);
    const clamped = Math.min(Math.max(0, data.position), ids.length);
    ids.splice(clamped, 0, id);
    await reorderStages(stage.pipelineId, ids);
  }

  const payload: Prisma.StageUpdateInput = {};

  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw new Error("INVALID_NAME");
    payload.name = name;
  }
  if (data.color !== undefined) payload.color = data.color;
  if (data.winProbability !== undefined) payload.winProbability = data.winProbability;
  if (data.rottingDays !== undefined) payload.rottingDays = data.rottingDays;

  if (Object.keys(payload).length === 0) {
    return prisma.stage.findUniqueOrThrow({ where: { id } });
  }

  return prisma.stage.update({
    where: { id },
    data: payload,
  });
}

export async function getStageInPipeline(pipelineId: string, stageId: string) {
  return prisma.stage.findFirst({
    where: { id: stageId, pipelineId },
  });
}

export async function deleteStage(id: string) {
  const stage = await prisma.stage.findUnique({ where: { id }, select: { isIncoming: true } });
  if (stage?.isIncoming) {
    throw new Error("CANNOT_DELETE_INCOMING_STAGE");
  }
  const count = await prisma.deal.count({ where: { stageId: id } });
  if (count > 0) {
    throw new Error("STAGE_HAS_DEALS");
  }
  await prisma.stage.delete({ where: { id } });
}

export async function reorderStages(pipelineId: string, stageIds: string[]) {
  const stages = await prisma.stage.findMany({
    where: { pipelineId },
    select: { id: true },
    orderBy: { position: "asc" },
  });

  const existingIds = new Set(stages.map((s) => s.id));
  if (stageIds.length !== existingIds.size || stageIds.some((id) => !existingIds.has(id))) {
    throw new Error("INVALID_STAGE_ORDER");
  }

  const offset = 10_000;

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < stageIds.length; i++) {
      await tx.stage.update({
        where: { id: stageIds[i] },
        data: { position: offset + i },
      });
    }
    for (let i = 0; i < stageIds.length; i++) {
      await tx.stage.update({
        where: { id: stageIds[i] },
        data: { position: i },
      });
    }
  });
}
