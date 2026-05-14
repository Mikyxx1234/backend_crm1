/**
 * Ações operacionais do agente de IA ("piloting") — lado do servidor.
 *
 * Reúnem duas primitivas compartilhadas entre o `inbox-handler`
 * (resposta a mensagens inbound) e o `ai-agent-inactivity-worker`
 * (varredura de silêncio do cliente):
 *
 *  - `sendAgentMessage`    — persiste + envia uma mensagem OUT pelo
 *    canal da conversa. Respeita `autonomyMode` (se DRAFT, grava como
 *    rascunho pro operador humano aprovar).
 *  - `executeAgentHandoff` — transfere a conversa para humano
 *    conforme o modo configurado (KEEP_OWNER / SPECIFIC_USER /
 *    UNASSIGN), registra activity + evento de deal e publica SSE.
 *
 * Mantemos isso FORA de `tools.ts` porque aqui o handoff é disparado
 * sem passar pelo LLM (evento determinístico).
 */

import type { AIAgentAutonomy } from "@prisma/client";

import {
  computeTypingDelayMs,
  renderTemplate,
} from "@/lib/ai-agents/piloting";
import { metaClientFromConfig } from "@/lib/meta-whatsapp/client";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { getOrgIdOrNull } from "@/lib/request-context";
import { sseBus } from "@/lib/sse-bus";
import { createActivity } from "@/services/activities";
import { createDealEvent } from "@/services/deals";

/**
 * Busca o wamid (externalId) da mensagem INBOUND mais recente da
 * conversa — necessário porque os endpoints Meta de "digitando…" e
 * "lido" só aceitam referenciar uma mensagem que O NEGÓCIO recebeu.
 *
 * A Meta só aceita o indicador/leitura se a mensagem tiver sido
 * recebida nos últimos ~30 segundos; acima disso a chamada falha
 * silenciosamente (por isso o `try/catch` nos helpers do cliente).
 */
async function getLatestInboundWamid(
  conversationId: string,
): Promise<string | null> {
  const row = await prisma.message.findFirst({
    where: {
      conversationId,
      direction: "in",
      externalId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { externalId: true },
  });
  return row?.externalId ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type SendAgentMessageResult =
  | { status: "sent"; messageId: string }
  | { status: "draft"; messageId: string }
  | { status: "skipped"; reason: string };

/**
 * Envia uma mensagem OUT em nome do agente. Para AUTONOMOUS + canal
 * Meta WhatsApp configurado, envia direto; caso contrário, grava
 * rascunho pro operador revisar.
 *
 * Não tenta fallback para Baileys (as rotinas de piloting rodam
 * fora do escopo do usuário logado — seria necessário resolver a
 * sessão Baileys correta por tenant, o que é escopo futuro).
 */
export type HumanBehaviorConfig = {
  simulateTyping: boolean;
  typingPerCharMs: number;
  markMessagesRead: boolean;
};

export async function sendAgentMessage(args: {
  conversationId: string;
  contactId: string;
  agentUserId: string;
  autonomyMode: AIAgentAutonomy;
  text: string;
  channel?: "meta" | "baileys" | null;
  /// Marcador de tipo pra distinguir no inbox (greeting / farewell / off_hours).
  kind?: "text" | "greeting" | "farewell" | "off_hours";
  /// Comportamento humano opcional: simula digitando + read receipts.
  /// Só tem efeito em AUTONOMOUS + meta + phoneNumberId válido.
  humanBehavior?: HumanBehaviorConfig;
}): Promise<SendAgentMessageResult> {
  const text = args.text.trim();
  if (!text) return { status: "skipped", reason: "empty" };

  const isMeta = args.channel === "meta" || args.channel == null;

  // Resolve cliente Meta DESTE canal (token/phoneId do tenant). Sem isso,
  // o agente IA da DNA enviava via numero da Eduit (singleton global env).
  const conv = await prisma.conversation.findUnique({
    where: { id: args.conversationId },
    select: { channelRef: { select: { id: true, config: true } } },
  });
  const channelConfig = conv?.channelRef?.config as
    | Record<string, unknown>
    | null
    | undefined;
  const metaClient = metaClientFromConfig(channelConfig);

  if (args.autonomyMode === "AUTONOMOUS" && isMeta && metaClient.configured) {
    const contact = await prisma.contact.findUnique({
      where: { id: args.contactId },
      select: { phone: true },
    });
    if (!contact?.phone) {
      return saveDraft(args.conversationId, args.agentUserId, text);
    }

    // ── Comportamento humano: typing + read ANTES de enviar ─────
    // Falhas aqui nunca bloqueiam o envio da resposta (os helpers do
    // MetaWhatsAppClient já engolem `sendTypingIndicator`; pra
    // `markAsRead` adicionamos try/catch local).
    if (args.humanBehavior) {
      const { simulateTyping, typingPerCharMs, markMessagesRead } =
        args.humanBehavior;
      const inboundWamid = await getLatestInboundWamid(args.conversationId);

      if (inboundWamid && simulateTyping) {
        // sendTypingIndicator implica status=read, então atende os
        // dois requisitos com UMA chamada.
        await metaClient.sendTypingIndicator(inboundWamid);
        const delayMs = computeTypingDelayMs(text.length, typingPerCharMs);
        await sleep(delayMs);
      } else if (inboundWamid && markMessagesRead) {
        try {
          await metaClient.markAsRead(inboundWamid);
        } catch (err) {
          console.warn(
            `[ai-piloting] markAsRead falhou conv=${args.conversationId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    let externalId: string | null = null;
    try {
      const send = await metaClient.sendText(contact.phone, text);
      externalId = send.messages?.[0]?.id ?? null;
    } catch (err) {
      console.error(
        `[ai-piloting] envio autônomo falhou conv=${args.conversationId}: ${err}. Gravando rascunho.`,
      );
      return saveDraft(args.conversationId, args.agentUserId, text);
    }

    const saved = await prisma.message.create({
      data: withOrgFromCtx({
        conversationId: args.conversationId,
        content: text,
        direction: "out",
        messageType: "text",
        authorType: "bot",
        aiAgentUserId: args.agentUserId,
        senderName: "Agente IA",
        externalId,
        sendStatus: "sent",
      }),
    });
    await prisma.conversation
      .update({
        where: { id: args.conversationId },
        data: {
          lastMessageDirection: "out",
          hasAgentReply: true,
          updatedAt: new Date(),
        },
      })
      .catch(() => null);
    sseBus.publish("new_message", {
      organizationId: getOrgIdOrNull(),
      conversationId: args.conversationId,
      contactId: args.contactId,
      direction: "out",
      content: text,
      timestamp: saved.createdAt,
    });
    return { status: "sent", messageId: saved.id };
  }

  return saveDraft(args.conversationId, args.agentUserId, text);
}

async function saveDraft(
  conversationId: string,
  agentUserId: string,
  text: string,
): Promise<SendAgentMessageResult> {
  const saved = await prisma.message.create({
    data: withOrgFromCtx({
      conversationId,
      content: text,
      direction: "out",
      messageType: "ai_draft",
      authorType: "bot",
      isPrivate: true,
      aiAgentUserId: agentUserId,
      senderName: "Agente IA (rascunho)",
      sendStatus: "draft",
    }),
  });
  sseBus.publish("new_message", {
    organizationId: getOrgIdOrNull(),
    conversationId,
    direction: "out",
    messageType: "ai_draft",
    content: text,
    timestamp: saved.createdAt,
  });
  return { status: "draft", messageId: saved.id };
}

/**
 * Retorna true se já existe pelo menos uma mensagem do agente
 * (authorType=bot + aiAgentUserId=agent) na conversa. Usado pra
 * decidir se a saudação inicial deve ser disparada.
 *
 * @deprecated — usar `hasAgentGreetedInCurrentAssignment`. Esse
 * helper via histórico de mensagens tinha o bug de bloquear saudação
 * eternamente após qualquer resposta anterior do agente, mesmo em
 * novas reatribuições.
 */
export async function agentHasEverRepliedInConversation(
  conversationId: string,
  agentUserId: string,
): Promise<boolean> {
  const existing = await prisma.message.findFirst({
    where: {
      conversationId,
      authorType: "bot",
      aiAgentUserId: agentUserId,
    },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Retorna true se o agente IA já disparou a saudação na atribuição
 * ATUAL da conversa. Usa `Conversation.aiGreetedAt`, que é setada
 * quando a saudação é enviada e RESETADA quando a conversa muda
 * de `assignedToId`.
 */
export async function hasAgentGreetedInCurrentAssignment(
  conversationId: string,
): Promise<boolean> {
  const row = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { aiGreetedAt: true },
  });
  return row?.aiGreetedAt != null;
}

/**
 * Marca que o agente IA cumprimentou nesta atribuição. Chamado logo
 * depois de `sendAgentMessage({ kind: "greeting" })` retornar com sucesso.
 */
export async function markAgentGreetedNow(
  conversationId: string,
): Promise<void> {
  await prisma.conversation
    .update({
      where: { id: conversationId },
      data: { aiGreetedAt: new Date() },
    })
    .catch(() => null);
}

// ── Saudação proativa (handoff entrando) ───────────────────────

export type TriggerOpeningResult =
  | { status: "sent"; messageId: string; conversationId: string }
  | { status: "draft"; messageId: string; conversationId: string }
  | {
      status: "skipped";
      reason:
        | "no_conversation"
        | "not_ai_agent"
        | "agent_inactive"
        | "no_opening_message"
        | "already_greeted"
        | "off_hours"
        | "no_contact";
    };

/**
 * Dispara a mensagem de saudação do agente IA PROATIVAMENTE — sem
 * precisar esperar o cliente mandar algo. Usado pelo executor de
 * automações no passo `transfer_to_ai_agent`: assim que a conversa
 * é atribuída ao agente, ele já se apresenta no chat do cliente
 * (em vez de ficar mudo até a primeira inbound, que pode nunca vir).
 *
 * A função é idempotente via `Conversation.aiGreetedAt` — se já
 * cumprimentou na atribuição atual, retorna `already_greeted` e
 * não duplica.
 *
 * Respeita business hours: fora do horário, envia `offHoursMessage`
 * se configurada e NÃO marca `aiGreetedAt` (pra saudar de verdade
 * na volta ao horário, via próxima inbound do cliente).
 */
export async function triggerAgentOpeningForContact(args: {
  contactId: string;
  agentUserId: string;
  channel?: "meta" | "baileys" | null;
}): Promise<TriggerOpeningResult> {
  // Usa a conversa aberta mais recente do contato. Na prática, o CRM
  // mantém 1 conversa por contato para canais (Meta/Baileys), então
  // isso resolve ao único canal ativo dele.
  const conversation = await prisma.conversation.findFirst({
    where: { contactId: args.contactId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, assignedToId: true, aiGreetedAt: true },
  });
  if (!conversation) {
    return { status: "skipped", reason: "no_conversation" };
  }

  const assignee = await prisma.user.findUnique({
    where: { id: args.agentUserId },
    select: {
      id: true,
      type: true,
      aiAgentConfig: {
        select: {
          active: true,
          autonomyMode: true,
          openingMessage: true,
          openingDelayMs: true,
          businessHours: true,
          simulateTyping: true,
          typingPerCharMs: true,
          markMessagesRead: true,
        },
      },
    },
  });
  if (!assignee || assignee.type !== "AI") {
    return { status: "skipped", reason: "not_ai_agent" };
  }
  const cfg = assignee.aiAgentConfig;
  if (!cfg?.active) {
    return { status: "skipped", reason: "agent_inactive" };
  }
  if (!cfg.openingMessage?.trim()) {
    return { status: "skipped", reason: "no_opening_message" };
  }
  if (conversation.aiGreetedAt != null) {
    return { status: "skipped", reason: "already_greeted" };
  }

  // Business hours gate — se fora, não dispara a saudação proativa.
  // Preferimos ficar em silêncio até a volta ao horário (a mensagem
  // offHours é pra RESPOSTA a inbound, não pra empurrar quando a
  // automação plantou o contato na conversa).
  const { isWithinBusinessHours, normalizeBusinessHours } = await import(
    "@/lib/ai-agents/piloting"
  );
  const bh = normalizeBusinessHours(cfg.businessHours);
  if (bh?.enabled && !isWithinBusinessHours(bh)) {
    return { status: "skipped", reason: "off_hours" };
  }

  // Contexto pra template da saudação ({{contactName}}, {{dealTitle}},
  // {{stageName}}). Reusa a MESMA mecânica do inbox-handler para que
  // a saudação fique visualmente idêntica quando disparada pelos dois
  // caminhos (automação vs. inbound).
  const [contact, openDeal] = await Promise.all([
    prisma.contact.findUnique({
      where: { id: args.contactId },
      select: { name: true },
    }),
    prisma.deal.findFirst({
      where: { contactId: args.contactId, status: "OPEN" },
      orderBy: { updatedAt: "desc" },
      select: { title: true, stage: { select: { name: true } } },
    }),
  ]);
  if (!contact) {
    return { status: "skipped", reason: "no_contact" };
  }

  const greeting = renderTemplate(cfg.openingMessage, {
    contactName: contact.name,
    dealTitle: openDeal?.title ?? null,
    stageName: openDeal?.stage?.name ?? null,
  });

  if (cfg.openingDelayMs > 0) {
    await sleep(Math.min(cfg.openingDelayMs, 10_000));
  }

  const result = await sendAgentMessage({
    conversationId: conversation.id,
    contactId: args.contactId,
    agentUserId: assignee.id,
    autonomyMode: cfg.autonomyMode,
    text: greeting,
    channel: args.channel ?? "meta",
    kind: "greeting",
    humanBehavior: {
      simulateTyping: cfg.simulateTyping,
      typingPerCharMs: cfg.typingPerCharMs,
      markMessagesRead: cfg.markMessagesRead,
    },
  });

  if (result.status !== "skipped") {
    await markAgentGreetedNow(conversation.id);
  }

  if (result.status === "sent") {
    return {
      status: "sent",
      messageId: result.messageId,
      conversationId: conversation.id,
    };
  }
  if (result.status === "draft") {
    return {
      status: "draft",
      messageId: result.messageId,
      conversationId: conversation.id,
    };
  }
  return { status: "skipped", reason: "no_contact" };
}

// ── Handoff ────────────────────────────────────────────────────

export type HandoffMode = "KEEP_OWNER" | "SPECIFIC_USER" | "UNASSIGN";

export type HandoffArgs = {
  conversationId: string;
  contactId: string | null;
  dealId: string | null;
  agentId: string;
  agentUserId: string;
  mode: HandoffMode;
  specificUserId?: string | null;
  reason: string;
};

/**
 * Executa o handoff determinístico. Retorna o userId que recebeu a
 * conversa (null se ficou em fila).
 */
export async function executeAgentHandoff(
  args: HandoffArgs,
): Promise<{ assignedToId: string | null }> {
  let newAssignee: string | null = null;

  if (args.mode === "SPECIFIC_USER" && args.specificUserId) {
    const exists = await prisma.user.findUnique({
      where: { id: args.specificUserId },
      select: { id: true, type: true },
    });
    if (exists && exists.type !== "AI") {
      newAssignee = exists.id;
    }
  } else if (args.mode === "KEEP_OWNER" && args.dealId) {
    const deal = await prisma.deal.findUnique({
      where: { id: args.dealId },
      select: { ownerId: true },
    });
    // Só mantém o dono se não for o próprio user IA (evita ficar em loop).
    if (deal?.ownerId && deal.ownerId !== args.agentUserId) {
      newAssignee = deal.ownerId;
    }
  }

  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: {
      assignedToId: newAssignee,
      // Reseta o marcador de saudação — se a conversa voltar pro
      // agente IA depois, ele cumprimenta de novo.
      aiGreetedAt: null,
      updatedAt: new Date(),
    },
  });

  if (args.contactId) {
    await createActivity({
      type: "NOTE",
      title: "Transferência IA → humano",
      description: args.reason,
      completed: true,
      contactId: args.contactId,
      dealId: args.dealId ?? undefined,
      userId: args.agentUserId,
    }).catch(() => null);
  }

  if (args.dealId) {
    createDealEvent(args.dealId, args.agentUserId, "AI_AGENT_ACTION", {
      action: "transferred_to_human",
      agentId: args.agentId,
      mode: args.mode,
      assignedToId: newAssignee,
      reason: args.reason,
    }).catch(() => null);
  }

  sseBus.publish(newAssignee ? "conversation_assigned" : "conversation_unassigned", {
    organizationId: getOrgIdOrNull(),
    conversationId: args.conversationId,
    contactId: args.contactId,
    assignedToId: newAssignee,
    reason: args.reason,
  });

  return { assignedToId: newAssignee };
}
