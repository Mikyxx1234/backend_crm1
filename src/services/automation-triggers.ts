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
    const deal = await prisma.deal.findFirst({
      where: { contactId: context.contactId, status: "OPEN" },
      select: {
        id: true,
        stageId: true,
        stage: { select: { pipelineId: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (deal) {
      return {
        ...context,
        dealId: context.dealId ?? deal.id,
        data: {
          ...data,
          dealStageId: deal.stageId,
          dealPipelineId: deal.stage.pipelineId,
        },
      };
    }
  }

  return context;
}

export async function fireTrigger(
  event: string,
  context: { contactId?: string; dealId?: string; data?: unknown }
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
