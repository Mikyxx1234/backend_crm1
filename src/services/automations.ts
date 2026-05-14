import type { Prisma } from "@prisma/client";

import { enqueueAutomationJob, type AutomationJobContext } from "@/lib/queue";

export type { AutomationJobContext } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import { getOrgIdOrThrow } from "@/lib/request-context";

export const AUTOMATION_TRIGGER_TYPES = [
  "stage_changed",
  "tag_added",
  "lead_score_reached",
  "deal_created",
  "deal_won",
  "deal_lost",
  "contact_created",
  "conversation_created",
  "lifecycle_changed",
  "agent_changed",
  "message_received",
  "message_sent",
] as const;

export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number];

export type AutomationTriggerEvaluationContext = AutomationJobContext;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function readNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

const STEP_ID_REF_KEYS = new Set([
  "nextStepId",
  "elseGotoStepId",
  "timeoutGotoStepId",
  "receivedGotoStepId",
  "targetStepId",
  "gotoStepId",
  "elseStepId",
  "_nextStepId",
  "_trueGotoStepId",
  "_falseGotoStepId",
  "_answeredGotoStepId",
]);

function remapStepRefsInValue(value: unknown, remap: Map<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => remapStepRefsInValue(entry, remap));
  }
  if (!value || typeof value !== "object") return value;

  const obj = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(obj)) {
    if (typeof raw === "string" && STEP_ID_REF_KEYS.has(key) && remap.has(raw)) {
      next[key] = remap.get(raw);
      continue;
    }
    next[key] = remapStepRefsInValue(raw, remap);
  }

  return next;
}

export function evaluateTrigger(
  triggerType: string,
  triggerConfig: unknown,
  context: AutomationTriggerEvaluationContext
): boolean {
  const cfg = asRecord(triggerConfig) ?? {};
  const data = asRecord(context.data) ?? {};

  switch (triggerType) {
    case "stage_changed": {
      const toStageId = readString(cfg, "toStageId");
      const fromStageId = readString(cfg, "fromStageId");
      const dataTo = readString(data, "toStageId");
      const dataFrom = readString(data, "fromStageId");
      if (toStageId && dataTo && dataTo !== toStageId) return false;
      if (fromStageId && dataFrom && dataFrom !== fromStageId) return false;
      return true;
    }
    case "tag_added": {
      const tagId = readString(cfg, "tagId");
      const tagName = readString(cfg, "tagName");
      const dataTagId = readString(data, "tagId");
      const dataTagName = readString(data, "tagName");
      if (tagId && dataTagId && dataTagId !== tagId) return false;
      if (tagName && dataTagName && dataTagName.toLowerCase() !== tagName.toLowerCase()) return false;
      return true;
    }
    case "lead_score_reached": {
      const threshold = readNumber(cfg, "threshold") ?? readNumber(cfg, "minScore");
      if (threshold === undefined) return true;
      const score =
        readNumber(data, "score") ??
        readNumber(data, "leadScore") ??
        readNumber(data, "newScore");
      if (score === undefined) return false;
      return score >= threshold;
    }
    case "deal_created":
    case "deal_won":
    case "deal_lost": {
      const pipelineId = readString(cfg, "pipelineId");
      const dataPipelineId = readString(data, "pipelineId");
      if (pipelineId && dataPipelineId && dataPipelineId !== pipelineId) return false;
      return true;
    }
    case "contact_created":
      return true;
    case "conversation_created": {
      const channel = readString(cfg, "channel");
      const dataChannel = readString(data, "channel");
      if (channel && dataChannel && dataChannel.toLowerCase() !== channel.toLowerCase()) return false;
      return true;
    }
    case "lifecycle_changed": {
      const toLifecycle = readString(cfg, "toLifecycle") ?? readString(cfg, "lifecycleStage");
      const dataTo = readString(data, "to") ?? readString(data, "toLifecycle") ?? readString(data, "lifecycleStage");
      if (toLifecycle && dataTo && dataTo !== toLifecycle) return false;
      const fromLifecycle = readString(cfg, "fromLifecycle") ?? readString(cfg, "from");
      const dataFrom = readString(data, "from") ?? readString(data, "fromLifecycle");
      if (fromLifecycle && dataFrom && dataFrom !== fromLifecycle) return false;
      return true;
    }
    case "agent_changed": {
      const toAgentId = readString(cfg, "toAgentId");
      const dataToAgent = readString(data, "toAgentId") ?? readString(data, "assignedToId");
      if (toAgentId && dataToAgent && dataToAgent !== toAgentId) return false;
      return true;
    }
    case "message_received":
    case "message_sent": {
      const channel = readString(cfg, "channel");
      const dataChannel = readString(data, "channel");
      if (channel && dataChannel && dataChannel.toLowerCase() !== channel.toLowerCase()) return false;
      const stageId = readString(cfg, "stageId");
      const dataStageId = readString(data, "dealStageId");
      if (stageId && dataStageId && dataStageId !== stageId) return false;
      if (stageId && !dataStageId) return false;
      const pipelineId = readString(cfg, "pipelineId");
      const dataPipelineId = readString(data, "dealPipelineId");
      if (pipelineId && dataPipelineId && dataPipelineId !== pipelineId) return false;
      return true;
    }
    default:
      return true;
  }
}

export type GetAutomationsParams = {
  active?: boolean;
  search?: string;
  page?: number;
  perPage?: number;
};

const automationListSelect = {
  id: true,
  name: true,
  description: true,
  triggerType: true,
  triggerConfig: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { steps: true } },
} satisfies Prisma.AutomationSelect;

export async function getAutomations(params: GetAutomationsParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(100, Math.max(1, params.perPage ?? 20));
  const skip = (page - 1) * perPage;

  const where: Prisma.AutomationWhereInput = {};
  if (params.active !== undefined) {
    where.active = params.active;
  }
  const search = params.search?.trim();
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.automation.findMany({
      where,
      skip,
      take: perPage,
      orderBy: [{ updatedAt: "desc" }],
      select: automationListSelect,
    }),
    prisma.automation.count({ where }),
  ]);

  return {
    items: items.map(({ _count, ...rest }) => ({
      ...rest,
      stepCount: _count.steps,
    })),
    total,
    page,
    perPage,
  };
}

export async function getAutomationById(id: string) {
  return prisma.automation.findUnique({
    where: { id },
    include: {
      steps: { orderBy: { position: "asc" } },
    },
  });
}

export type CreateAutomationStepInput = {
  id?: string;
  type: string;
  config: Prisma.InputJsonValue;
};

export type CreateAutomationInput = {
  name: string;
  description?: string | null;
  triggerType: string;
  triggerConfig: Prisma.InputJsonValue;
  active?: boolean;
  steps: CreateAutomationStepInput[];
};

export async function createAutomation(
  data: CreateAutomationInput,
): Promise<Prisma.AutomationGetPayload<{ include: { steps: true } }>> {
  const name = data.name?.trim();
  if (!name) {
    throw new Error("INVALID_NAME");
  }

  const organizationId = getOrgIdOrThrow();
  return prisma.automation.create({
    data: {
      name,
      organizationId,
      description: data.description?.trim() || null,
      triggerType: data.triggerType,
      triggerConfig: data.triggerConfig,
      active: data.active ?? false,
      steps: {
        create: data.steps.map((s, index) => ({
          ...(s.id ? { id: s.id } : {}),
          type: s.type,
          config: s.config,
          position: index,
          organizationId,
        })),
      },
    },
    include: { steps: { orderBy: { position: "asc" } } },
  }) as unknown as Prisma.AutomationGetPayload<{ include: { steps: true } }>;
}

export type UpdateAutomationInput = {
  name?: string;
  description?: string | null;
  triggerType?: string;
  triggerConfig?: Prisma.InputJsonValue;
  active?: boolean;
  steps?: CreateAutomationStepInput[];
};

export async function updateAutomation(id: string, data: UpdateAutomationInput) {
  const existing = await prisma.automation.findUnique({ where: { id } });
  if (!existing) {
    throw new Error("NOT_FOUND");
  }

  return prisma.$transaction(async (tx) => {
    if (data.steps) {
      await tx.automationStep.deleteMany({ where: { automationId: id } });

      const providedIds = data.steps.filter((s) => s.id).map((s) => s.id!);
      let conflicting: string[] = [];
      if (providedIds.length > 0) {
        const existing = await tx.automationStep.findMany({
          where: { id: { in: providedIds } },
          select: { id: true },
        });
        conflicting = existing.map((e) => e.id);
      }

      if (conflicting.length > 0) {
        const remap = new Map<string, string>();
        for (const oldId of conflicting) {
          remap.set(oldId, `step_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);
        }
        data.steps = data.steps.map((s) => {
          const newId = s.id ? remap.get(s.id) : undefined;
          const cfg = remapStepRefsInValue(s.config, remap);
          return { ...s, id: newId ?? s.id, config: cfg as Prisma.InputJsonValue };
        });
      }
    }

    const updateData: Prisma.AutomationUpdateInput = {};
    if (data.name !== undefined) {
      const trimmed = data.name.trim();
      if (!trimmed) throw new Error("INVALID_NAME");
      updateData.name = trimmed;
    }
    if (data.description !== undefined) {
      updateData.description = data.description === null ? null : data.description.trim() || null;
    }
    if (data.triggerType !== undefined) {
      updateData.triggerType = data.triggerType;
    }
    if (data.triggerConfig !== undefined) {
      updateData.triggerConfig = data.triggerConfig;
    }
    if (data.active !== undefined) {
      updateData.active = data.active;
    }
    if (data.steps) {
      const organizationId = getOrgIdOrThrow();
      updateData.steps = {
        create: data.steps.map((s, index) => ({
          ...(s.id ? { id: s.id } : {}),
          type: s.type,
          config: s.config,
          position: index,
          organizationId,
        })),
      };
    }

    return tx.automation.update({
      where: { id },
      data: updateData,
      include: { steps: { orderBy: { position: "asc" } } },
    });
  });
}

export async function deleteAutomation(id: string) {
  await prisma.automation.delete({ where: { id } });
}

export async function toggleAutomation(id: string) {
  const existing = await prisma.automation.findUnique({ where: { id }, select: { id: true, active: true } });
  if (!existing) {
    throw new Error("NOT_FOUND");
  }
  return prisma.automation.update({
    where: { id },
    data: { active: !existing.active },
    include: { steps: { orderBy: { position: "asc" } } },
  });
}

export type GetAutomationLogsParams = {
  page?: number;
  perPage?: number;
  stepId?: string | null;
};

export async function getAutomationLogs(automationId: string, params: GetAutomationLogsParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(100, Math.max(1, params.perPage ?? 20));
  const skip = (page - 1) * perPage;

  const where: Prisma.AutomationLogWhereInput = { automationId };
  if (params.stepId === "trigger") {
    where.stepId = null;
  } else if (params.stepId) {
    where.stepId = params.stepId;
  }

  const [items, total] = await Promise.all([
    prisma.automationLog.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { executedAt: "desc" },
    }),
    prisma.automationLog.count({ where }),
  ]);

  return { items, total, page, perPage };
}

export async function enqueueAutomation(automationId: string, context: AutomationJobContext) {
  return enqueueAutomationJob({ automationId, context });
}
