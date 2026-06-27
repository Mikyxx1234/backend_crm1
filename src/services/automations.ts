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
  "call_received",
  "call_made",
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
      if (pipelineId && !dataPipelineId) return false;
      // 27/mai/26 — Adicionado filtro por `stageId` (e suporte a `toStageId`
      // como alias, pra alinhar com o payload do auto-deal). Antes só
      // filtrava pipeline; agora o operador consegue criar "automação X
      // quando lead/deal entra no estágio Y".
      const stageId = readString(cfg, "stageId");
      const dataStageId = readString(data, "stageId") ?? readString(data, "toStageId");
      if (stageId && dataStageId && dataStageId !== stageId) return false;
      if (stageId && !dataStageId) return false;
      return true;
    }
    case "contact_created": {
      // 27/mai/26 — Filtros por pipeline/estágio adicionados. O evento é
      // disparado ANTES do auto-deal ser criado, então `enrichContext`
      // tenta carregar o deal aberto do contato (race best-effort). Se
      // nenhum filtro estiver configurado, segue passando como antes.
      const pipelineId = readString(cfg, "pipelineId");
      const dataPipelineId = readString(data, "pipelineId") ?? readString(data, "dealPipelineId");
      if (pipelineId && dataPipelineId && dataPipelineId !== pipelineId) return false;
      if (pipelineId && !dataPipelineId) return false;
      const stageId = readString(cfg, "stageId");
      const dataStageId =
        readString(data, "stageId") ??
        readString(data, "dealStageId") ??
        readString(data, "toStageId");
      if (stageId && dataStageId && dataStageId !== stageId) return false;
      if (stageId && !dataStageId) return false;
      return true;
    }
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
      // 27/mai/26 (v2) — Best-effort: o filtro de estagio/pipeline so
      // descarta o evento quando CONHECEMOS o estagio do contato (via
      // deal aberto enriquecido em `enrichContext`) e ele DIVERGE do
      // filtro. Se nao conhecemos (sem deal aberto, contato novo, etc.)
      // deixamos passar — caso contrario o gatilho "mensagem recebida"
      // nunca dispara pra contatos sem negocio aberto, que e o cenario
      // mais comum em receptivo.
      const channel = readString(cfg, "channel");
      const dataChannel = readString(data, "channel");
      if (channel && dataChannel && dataChannel.toLowerCase() !== channel.toLowerCase()) return false;
      const stageId = readString(cfg, "stageId");
      const dataStageId = readString(data, "stageId") ?? readString(data, "dealStageId");
      if (stageId && dataStageId && dataStageId !== stageId) return false;
      const pipelineId = readString(cfg, "pipelineId");
      const dataPipelineId = readString(data, "pipelineId") ?? readString(data, "dealPipelineId");
      if (pipelineId && dataPipelineId && dataPipelineId !== pipelineId) return false;
      // 27/mai/26 (v3) — Filtro por status do negocio (OPEN/WON/LOST).
      // Aceita CSV pra "qualquer um de" (ex.: "WON,LOST") — o front
      // expoe isso como a opcao composta "Ganho ou Perdido", que e o
      // caso pratico de retencao/reengajamento. Ao contrario de
      // stage/pipeline, aqui somos estritos: se o operador filtrou
      // por status e o contato nao tem nenhum deal (data sem
      // `dealStatus`), a automacao NAO dispara — o filtro deixaria de
      // ter sentido se passasse pra contatos sem negocio.
      const dealStatus = readString(cfg, "dealStatus");
      if (dealStatus) {
        const accepted = dealStatus
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);
        if (accepted.length > 0) {
          const dataDealStatus = readString(data, "dealStatus");
          if (!dataDealStatus) return false;
          if (!accepted.includes(dataDealStatus.toUpperCase())) return false;
        }
      }
      return true;
    }
    case "call_received":
    case "call_made": {
      // Filtro por resultado da ligação. O payload (services/calls.ts)
      // inclui `answered: boolean`. status "" = qualquer; "answered" =
      // só atendidas; "missed" = só não atendidas.
      const status = readString(cfg, "status");
      if (status === "answered" || status === "missed") {
        const answered = data.answered === true;
        if (status === "answered" && !answered) return false;
        if (status === "missed" && answered) return false;
      }
      return true;
    }
    case "manual": {
      // 27/mai/26 — Gatilho imperativo. O operador escolheu rodar a
      // automacao explicitamente pelo botao "Rodar automacao" na
      // conversa (inbox/kanban); nao ha filtro a avaliar. A
      // protecao contra disparo nao-autorizado fica no endpoint
      // POST /api/automations/:id/run, que so enfileira automacoes
      // ativas com triggerType="manual".
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
  /**
   * 27/mai/26 — Filtro por `triggerType` (usado pelo botao "Rodar
   * automacao" no inbox/kanban pra listar so as automacoes com
   * gatilho `manual`). Aceita string unica; se necessario no futuro
   * pode virar string[].
   */
  triggerType?: string;
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
  // Tipos dos passos (na ordem) para o mini-fluxo do card refletir o
  // workflow real — antes a UI caía num fluxo mock fixo. Só `type` é
  // selecionado (payload mínimo); a config completa fica no detalhe.
  steps: { select: { type: true }, orderBy: { position: "asc" } },
} satisfies Prisma.AutomationSelect;

export async function getAutomations(params: GetAutomationsParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(100, Math.max(1, params.perPage ?? 20));
  const skip = (page - 1) * perPage;

  const organizationId = getOrgIdOrThrow();
  const where: Prisma.AutomationWhereInput = { organizationId };
  if (params.active !== undefined) {
    where.active = params.active;
  }
  if (params.triggerType) {
    where.triggerType = params.triggerType;
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

  // Métricas reais por automação (execuções/sucesso/última). Logs de nível
  // de gatilho (stepId = null) descrevem cada execução:
  //   • STARTED              = 1 por execução iniciada (→ "execuções")
  //   • COMPLETED            = terminou sem erro de passo
  //   • COMPLETED_WITH_ERRORS / FAILED = terminou com falha
  // Tudo agregado em poucas queries (groupBy) — escala independente da
  // quantidade de automações na página. Filtrar por `automationId in ids`
  // (ids já são da org) garante o escopo mesmo no nível de log.
  const stats = await buildAutomationListStats(items.map((i) => i.id));

  return {
    items: items.map(({ _count, steps, ...rest }) => ({
      ...rest,
      stepCount: _count.steps,
      stepTypes: steps.map((s) => s.type),
      ...(stats.get(rest.id) ?? EMPTY_AUTOMATION_STATS),
    })),
    total,
    page,
    perPage,
  };
}

type AutomationListStats = {
  runs: number;
  runsToday: number;
  successRate: number;
  lastRunAt: string | null;
};

const EMPTY_AUTOMATION_STATS: AutomationListStats = {
  runs: 0,
  runsToday: 0,
  successRate: 0,
  lastRunAt: null,
};

async function buildAutomationListStats(
  ids: string[],
): Promise<Map<string, AutomationListStats>> {
  const out = new Map<string, AutomationListStats>();
  if (ids.length === 0) return out;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [statusAgg, lastRuns, todayAgg] = await Promise.all([
    prisma.automationLog.groupBy({
      by: ["automationId", "status"],
      where: { automationId: { in: ids }, stepId: null },
      _count: { id: true },
    }),
    prisma.automationLog.groupBy({
      by: ["automationId"],
      where: { automationId: { in: ids }, stepId: null },
      _max: { executedAt: true },
    }),
    prisma.automationLog.groupBy({
      by: ["automationId"],
      where: {
        automationId: { in: ids },
        stepId: null,
        status: "STARTED",
        executedAt: { gte: startOfToday },
      },
      _count: { id: true },
    }),
  ]);

  const accum = new Map<
    string,
    { started: number; completed: number; finishedWithError: number }
  >();
  for (const row of statusAgg) {
    const cur = accum.get(row.automationId) ?? {
      started: 0,
      completed: 0,
      finishedWithError: 0,
    };
    const n = row._count.id;
    if (row.status === "STARTED") cur.started += n;
    else if (row.status === "COMPLETED") cur.completed += n;
    else if (row.status === "COMPLETED_WITH_ERRORS" || row.status === "FAILED")
      cur.finishedWithError += n;
    accum.set(row.automationId, cur);
  }

  const lastRunMap = new Map<string, string | null>();
  for (const row of lastRuns) {
    lastRunMap.set(
      row.automationId,
      row._max.executedAt ? row._max.executedAt.toISOString() : null,
    );
  }

  const todayMap = new Map<string, number>();
  for (const row of todayAgg) {
    todayMap.set(row.automationId, row._count.id);
  }

  for (const id of ids) {
    const a = accum.get(id) ?? {
      started: 0,
      completed: 0,
      finishedWithError: 0,
    };
    const finished = a.completed + a.finishedWithError;
    out.set(id, {
      // "execuções" = quantas vezes o fluxo rodou (STARTED). Se por algum
      // motivo só houver logs terminais, caímos no total finalizado.
      runs: a.started || finished,
      runsToday: todayMap.get(id) ?? 0,
      successRate:
        finished > 0 ? Math.round((a.completed / finished) * 100) : 0,
      lastRunAt: lastRunMap.get(id) ?? null,
    });
  }

  return out;
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
  steps?: CreateAutomationStepInput[];
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
        create: (data.steps ?? []).map((s, index) => ({
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
      include: {
        metaWebhookEvent: {
          select: {
            id: true,
            receivedAt: true,
            eventType: true,
            objectType: true,
            phoneNumberId: true,
            waMessageId: true,
            fromPhone: true,
            signatureValid: true,
            processed: true,
            processingError: true,
            headers: true,
            rawBody: true,
          },
        },
      },
    }).then(async (logs) => {
      // Enriquece com dados de ad-tracking do contato. Como nem todo log
      // tem contactId e nem todo contato tem ad-tracking, fazemos uma
      // query separada batch e fundimos no frontend.
      const contactIds = Array.from(
        new Set(
          logs
            .map((l) => l.contactId)
            .filter((v): v is string => typeof v === "string"),
        ),
      );
      if (contactIds.length === 0) return logs;
      const contacts = await prisma.contact.findMany({
        where: { id: { in: contactIds } },
        select: {
          id: true,
          adSourceId: true,
          adSourceType: true,
          adCtwaClid: true,
          adHeadline: true,
          adResolvedId: true,
          adResolvedName: true,
          adResolvedAdsetId: true,
          adResolvedAdsetName: true,
          adResolvedCampaignId: true,
          adResolvedCampaignName: true,
          adResolvedAt: true,
          adResolveStatus: true,
          adResolveError: true,
          adUtmSource: true,
          adUtmMedium: true,
          adUtmCampaign: true,
          adUtmContent: true,
          adUtmTerm: true,
        },
      });
      const byId = new Map(contacts.map((c) => [c.id, c]));
      return logs.map((l) => ({
        ...l,
        contactAdTracking:
          l.contactId && byId.has(l.contactId) ? byId.get(l.contactId) : null,
      }));
    }),
    prisma.automationLog.count({ where }),
  ]);

  return { items, total, page, perPage };
}

export async function enqueueAutomation(automationId: string, context: AutomationJobContext) {
  return enqueueAutomationJob({ automationId, context });
}
