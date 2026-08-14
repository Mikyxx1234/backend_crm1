/**
 * Espelha ActivityEvent da conversa no chat (Message event:{action}).
 * Textos curtos — sem prefixo "Evento do sistema".
 */

import {
  createConversationEvent,
  type ConversationEventAction,
} from "@/services/conversation-events";

type MirrorInput = {
  type: string;
  entityType?: string;
  entityId?: string;
  conversationId?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  meta?: Record<string, unknown>;
  actor?: { type?: string; label?: string | null } | null;
};

function statusLabel(raw: string | null | undefined): string {
  switch ((raw ?? "").toUpperCase()) {
    case "OPEN":
      return "Em atendimento";
    case "RESOLVED":
      return "Encerrada";
    case "PENDING":
      return "Pendente";
    case "SNOOZED":
      return "Adiada";
    default:
      return (raw ?? "").trim() || "atualizado";
  }
}

function actorName(input: MirrorInput): string {
  const label = input.actor?.label?.trim();
  if (label) return label.replace(/\s*·\s*Distribuição.*$/i, "").trim() || label;
  const t = (input.actor?.type ?? "").toUpperCase();
  if (t === "HUMAN") return "Agente";
  if (t === "AUTOMATION") return "Agente IA";
  return "Sistema";
}

function conversationIdOf(input: MirrorInput): string | null {
  if (input.conversationId) return input.conversationId;
  if (input.entityType === "CONVERSATION" && input.entityId) return input.entityId;
  return null;
}

function mapChatEvent(
  input: MirrorInput,
): { action: ConversationEventAction; text: string; actor: string } | null {
  const type = input.type;
  const actor = actorName(input);
  const from = (input.oldValue ?? "").trim();
  const to = (input.newValue ?? "").trim();
  const meta = (input.meta ?? {}) as Record<string, unknown>;
  const dept =
    (typeof meta.toDepartmentName === "string" && meta.toDepartmentName) ||
    (typeof meta.departmentName === "string" && meta.departmentName) ||
    "";

  switch (type) {
    case "LEAD_DISTRIBUTED": {
      const who = to || actor;
      const dest = dept ? `${dept} → ${who}` : who;
      return {
        action: "distribuicao",
        text: dest ? `Conversa distribuída para ${dest}` : "Conversa distribuída",
        actor: /ia/i.test(actor) ? "Agente IA" : "Sistema",
      };
    }
    case "ASSIGNEE_CHANGED": {
      if (from && to) {
        const dest = dept ? `${to} (${dept})` : to;
        return {
          action: "transferencia",
          text: `Transferida de ${from} para ${dest}`,
          actor,
        };
      }
      if (!from && to) {
        if (actor === to || actor.toLowerCase() === to.toLowerCase()) {
          return { action: "entrada", text: `${to} entrou na conversa`, actor: to };
        }
        return {
          action: "distribuicao",
          text: `Conversa distribuída para ${to}`,
          actor: actor || "Sistema",
        };
      }
      if (from && !to) {
        return { action: "saida", text: `${from} saiu da conversa`, actor: from };
      }
      return null;
    }
    case "CONVERSATION_DEPARTMENT_CHANGED": {
      if (from && to) {
        return {
          action: "transferencia",
          text: `Transferida de ${from} para ${to}`,
          actor,
        };
      }
      if (to) {
        return {
          action: "transferencia",
          text: `Transferida para ${to}`,
          actor,
        };
      }
      return null;
    }
    case "CONVERSATION_STATUS_CHANGED":
    case "CONVERSATION_CLOSED":
    case "CONVERSATION_REOPENED":
      return {
        action: "status",
        text: `Status alterado para ${statusLabel(to || type)}`,
        actor,
      };
    case "CONVERSATION_TABULATED": {
      const name =
        (typeof meta.tabulationName === "string" && meta.tabulationName) || to;
      return {
        action: "status",
        text: name ? `Conversa tabulada: ${name}` : "Conversa tabulada",
        actor,
      };
    }
    case "TAG_ADDED": {
      const name =
        (typeof meta.tagName === "string" && meta.tagName) || to || "tag";
      return { action: "tag", text: `Tag adicionada: ${name}`, actor };
    }
    case "TAG_REMOVED": {
      const name =
        (typeof meta.tagName === "string" && meta.tagName) || to || "tag";
      return { action: "tag", text: `Tag removida: ${name}`, actor };
    }
    case "AI_AGENT_HANDOFF":
      return {
        action: "ia",
        text: "Agente IA transferiu o atendimento",
        actor: "Agente IA",
      };
    default:
      return null;
  }
}

/** Fire-and-forget. Não lança. */
export function mirrorConversationChatEvent(input: MirrorInput): void {
  const conversationId = conversationIdOf(input);
  if (!conversationId) return;
  const mapped = mapChatEvent(input);
  if (!mapped) return;

  const dedupeStartsWith =
    mapped.action === "distribuicao"
      ? ["Conversa distribuída", "Conversa enfileirada"]
      : mapped.action === "ia"
        ? ["Agente IA sugeriu", "Agente IA transferiu", mapped.text.slice(0, 40)]
        : [mapped.text.slice(0, 40)];

  void createConversationEvent({
    conversationId,
    action: mapped.action,
    text: mapped.text,
    actor: mapped.actor,
    authorType: mapped.actor === "Agente IA" ? "bot" : "system",
    dedupeStartsWith,
    dedupeWindowMs: mapped.action === "distribuicao" ? 120_000 : 20_000,
  }).catch(() => {});
}
