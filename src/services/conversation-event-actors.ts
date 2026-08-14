/**
 * Resolve o ator humano de EVENTOS do chat já gravados como "Agente".
 * ActivityEvent.actorUserId existe mesmo quando Message.senderName é genérico.
 */

import { prisma } from "@/lib/prisma";
import {
  formatHumanActorDisplayName,
  isGenericHumanEventActor,
} from "@/lib/human-actor-name";
import { isEventMessageType } from "@/services/conversation-events";

export type EventActorEnrichment = {
  senderName: string;
  senderUserId: string | null;
};

type EventRowLike = {
  id: string;
  messageType: string;
  senderName: string | null;
  createdAt: Date;
};

function activityMatchesMessage(
  activityType: string,
  messageType: string,
  content: string,
): boolean {
  const action = messageType.toLowerCase().startsWith("event:")
    ? messageType.slice("event:".length).toLowerCase()
    : "";
  const c = content.toLowerCase();
  switch (activityType) {
    case "CONVERSATION_TABULATED":
      return action === "status" && c.includes("tabulad");
    case "CONVERSATION_STATUS_CHANGED":
    case "CONVERSATION_CLOSED":
    case "CONVERSATION_REOPENED":
      return action === "status" && c.includes("status");
    case "TAG_ADDED":
      return action === "tag" && /adicion/.test(c);
    case "TAG_REMOVED":
      return action === "tag" && /remov/.test(c);
    case "ASSIGNEE_CHANGED":
      return (
        action === "transferencia" ||
        action === "entrada" ||
        action === "saida" ||
        action === "distribuicao"
      );
    case "CONVERSATION_DEPARTMENT_CHANGED":
      return action === "transferencia";
    default:
      return false;
  }
}

/**
 * Para cada evento com senderName genérico ("Agente"), devolve nome curto
 * + actorUserId a partir do ActivityEvent da mesma conversa.
 */
export async function enrichEventMessageActors(
  groups: Array<{ conversationId: string; rows: EventRowLike[]; contents: string[] }>,
): Promise<Map<string, EventActorEnrichment>> {
  const out = new Map<string, EventActorEnrichment>();
  const generic: Array<{
    conversationId: string;
    row: EventRowLike;
    content: string;
  }> = [];

  for (const g of groups) {
    g.rows.forEach((row, i) => {
      if (!isEventMessageType(row.messageType)) return;
      if (!isGenericHumanEventActor(row.senderName)) return;
      generic.push({
        conversationId: g.conversationId,
        row,
        content: g.contents[i] ?? "",
      });
    });
  }
  if (generic.length === 0) return out;

  const conversationIds = [...new Set(generic.map((g) => g.conversationId))];
  const times = generic.map((g) => g.row.createdAt.getTime());
  const min = new Date(Math.min(...times) - 8_000);
  const max = new Date(Math.max(...times) + 8_000);

  const events = await prisma.activityEvent.findMany({
    where: {
      conversationId: { in: conversationIds },
      actorUserId: { not: null },
      actorType: "HUMAN",
      occurredAt: { gte: min, lte: max },
    },
    select: {
      conversationId: true,
      type: true,
      occurredAt: true,
      actorUserId: true,
      actorLabel: true,
      actorUser: { select: { name: true, email: true, type: true } },
    },
  });

  const used = new Set<number>();
  for (const item of generic) {
    let bestIdx = -1;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < events.length; i++) {
      if (used.has(i)) continue;
      const ev = events[i];
      if (ev.conversationId !== item.conversationId) continue;
      if (!activityMatchesMessage(ev.type, item.row.messageType, item.content)) {
        continue;
      }
      const delta = Math.abs(ev.occurredAt.getTime() - item.row.createdAt.getTime());
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) continue;
    used.add(bestIdx);
    const ev = events[bestIdx];
    if (ev.actorUser?.type === "AI") continue;
    const name = formatHumanActorDisplayName(
      ev.actorUser?.name ?? ev.actorLabel,
      ev.actorUser?.email,
    );
    if (!name) continue;
    out.set(item.row.id, {
      senderName: name,
      senderUserId: ev.actorUserId,
    });
  }

  return out;
}
