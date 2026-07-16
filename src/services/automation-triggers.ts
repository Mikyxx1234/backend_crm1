import { prisma } from "@/lib/prisma";

import {
  enqueueAutomation,
  evaluateTrigger,
  type AutomationJobContext,
} from "@/services/automations";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
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

async function enrichContext(event: string, context: AutomationJobContext): Promise<AutomationJobContext> {
  const data = asRecord(context.data) ?? {};

  if (event === "lead_score_reached" && context.contactId) {
    if (readNumber(data, "score") === undefined && readNumber(data, "leadScore") === undefined) {
      const contact = await prisma.contact.findUnique({
        where: { id: context.contactId },
        select: { leadScore: true },
      });
      if (contact) {
        return { ...context, data: { ...data, score: contact.leadScore } };
      }
    }
    return context;
  }

  if ((event === "message_received" || event === "message_sent") && context.contactId) {
    // 27/mai/26 (v3) — Suporte ao filtro `dealStatus` (OPEN/WON/LOST).
    // Antes pegavamos só o deal OPEN; agora priorizamos OPEN mas, se
    // o contato não tem nenhum aberto, caímos no deal mais recente
    // (qualquer status). Assim conseguimos enriquecer com `dealStatus`
    // pra clientes que já viraram WON/LOST e voltaram a mandar
    // mensagem (pós-venda, reengajamento, etc.).
    let deal = await prisma.deal.findFirst({
      where: { contactId: context.contactId, status: "OPEN" },
      select: {
        id: true,
        status: true,
        stageId: true,
        stage: { select: { pipelineId: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (!deal) {
      deal = await prisma.deal.findFirst({
        where: { contactId: context.contactId, status: { in: ["WON", "LOST"] } },
        select: {
          id: true,
          status: true,
          stageId: true,
          stage: { select: { pipelineId: true } },
        },
        orderBy: { updatedAt: "desc" },
      });
    }
    if (deal) {
      return {
        ...context,
        dealId: context.dealId ?? deal.id,
        data: {
          ...data,
          // Mantemos os dois conjuntos de chaves pra retro-compat:
          // `dealStageId`/`dealPipelineId` (legado) e `stageId`/`pipelineId`
          // (alinhado com o payload de deal_created e com o config da UI).
          stageId: deal.stageId,
          pipelineId: deal.stage.pipelineId,
          dealStageId: deal.stageId,
          dealPipelineId: deal.stage.pipelineId,
          dealStatus: deal.status,
        },
      };
    }
  }

  if (event === "contact_created" && context.contactId) {
    // 27/mai/26 — Enriquecimento best-effort para suportar filtro por
    // pipeline/estágio em "contato criado". O auto-deal é criado em
    // paralelo (fire-and-forget) com este trigger; se já tiver entrado
    // até aqui, conseguimos preencher o estágio. Quando não, o
    // `evaluateTrigger` filtra fora — o operador deve usar o gatilho
    // `deal_created` se quiser garantia absoluta.
    const deal = await prisma.deal.findFirst({
      where: { contactId: context.contactId, status: "OPEN" },
      select: {
        id: true,
        stageId: true,
        stage: { select: { pipelineId: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    if (deal) {
      return {
        ...context,
        dealId: context.dealId ?? deal.id,
        data: {
          ...data,
          stageId: deal.stageId,
          pipelineId: deal.stage.pipelineId,
        },
      };
    }
  }

  return context;
}

export async function fireTrigger(
  event: string,
  context: { contactId?: string; dealId?: string; data?: unknown; depth?: number }
): Promise<void> {
  let automations;
  try {
    automations = await prisma.automation.findMany({
      where: { active: true, triggerType: event },
      select: { id: true, name: true, triggerType: true, triggerConfig: true },
    });
  } catch (dbErr) {
    console.error(`[fireTrigger] DB error:`, dbErr);
    return;
  }

  if (automations.length === 0) return;

  const baseContext: AutomationJobContext = {
    contactId: context.contactId,
    dealId: context.dealId,
    event,
    data: context.data,
    // Propaga a profundidade de encadeamento pro job enfileirado, pra que
    // um efeito colateral (ex.: passo "mover etapa") herde depth+1.
    depth: context.depth ?? 0,
  };

  for (const automation of automations) {
    try {
      const enriched = await enrichContext(event, baseContext);
      const passes = evaluateTrigger(automation.triggerType, automation.triggerConfig, {
        ...enriched,
        event,
      });

      if (passes) {
        await enqueueAutomation(automation.id, { ...enriched, event });
        console.info(`[fireTrigger] "${automation.name}" disparada (${event})`);
      }
    } catch (err) {
      console.error(`[fireTrigger] Erro "${automation.name}":`, err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Teto de encadeamento de `stage_changed` disparado por efeito de
 * automação (passo "mover etapa", update_field stageId, tool da IA).
 * Protege contra loop A→B→A: a automação A move pro estágio X, o gatilho
 * de B roda e move de volta, e assim por diante. Acima do teto, paramos de
 * re-disparar (a movimentação em si ainda acontece; só não encadeia mais).
 */
const MAX_STAGE_CHAIN_DEPTH = 5;

/**
 * Ponto ÚNICO para notificar mudança de etapa de um negócio ao motor de
 * automações. Usado por TODOS os caminhos que alteram `deal.stageId` fora
 * do kanban/rota (executor de automação, tool da IA, etc.), pra que o
 * gatilho "mudança de fase" fique confiável independente de como a etapa
 * mudou. Idempotente em relação a no-op (from === to) e resiliente
 * (nunca lança — é fire-and-forget).
 *
 * `depth` é a profundidade de encadeamento do disparo (0 = ação direta do
 * usuário/IA; >0 = efeito de outra automação). Acima de MAX_STAGE_CHAIN_DEPTH
 * o disparo é suprimido pra cortar loops.
 */
export async function notifyDealStageChanged(
  dealId: string,
  fromStageId: string | null | undefined,
  toStageId: string | null | undefined,
  opts?: { contactId?: string | null; depth?: number },
): Promise<void> {
  try {
    if (!dealId || !toStageId) return;
    // Sem mudança real de etapa: não dispara (reordenar na mesma coluna,
    // patch redundante, etc.).
    if (fromStageId && fromStageId === toStageId) return;

    const depth = opts?.depth ?? 0;
    if (depth > MAX_STAGE_CHAIN_DEPTH) {
      console.warn(
        `[notifyDealStageChanged] encadeamento acima do teto (${depth}) — disparo suprimido p/ evitar loop (deal=${dealId})`,
      );
      return;
    }

    await fireTrigger("stage_changed", {
      dealId,
      contactId: opts?.contactId ?? undefined,
      data: { fromStageId: fromStageId ?? undefined, toStageId },
      depth,
    });
  } catch (err) {
    console.error(
      "[notifyDealStageChanged] falha ao disparar stage_changed:",
      err instanceof Error ? err.message : err,
    );
  }
}
