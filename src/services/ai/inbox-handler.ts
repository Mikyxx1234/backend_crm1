/**
 * Glue entre o webhook Meta/Baileys e o runner de agentes de IA.
 *
 * Estratégia: quando uma mensagem chega (direction=in) e a conversa
 * está atribuída a um User com type=AI, disparamos o runner.
 *
 * Antes de chamar o LLM, aplicamos os CONTROLES DE PILOTING:
 *
 *   1. Business hours — se a config tem horário habilitado e o
 *      momento atual está fora, envia `offHoursMessage` (se houver)
 *      e encerra sem invocar o LLM.
 *   2. Keyword handoff — se a mensagem do cliente bate com alguma
 *      `keywordHandoffs`, transferimos imediatamente pra humano
 *      (sem LLM).
 *   3. Opening message — se é a PRIMEIRA vez que o agente fala nesta
 *      conversa e existe uma saudação configurada, enviamos ela
 *      antes de processar a mensagem do cliente com o LLM.
 *   4. Só aí chamamos `runAgent`.
 *
 *  - `autonomyMode=AUTONOMOUS`: enviamos a resposta direto pelo
 *    WhatsApp e registramos uma Message OUT com `authorType=bot` e
 *    `aiAgentUserId` marcando a autoria.
 *  - `autonomyMode=DRAFT`: registramos a resposta como mensagem
 *    privada (`isPrivate=true`, `messageType=ai_draft`) para o operador
 *    humano aprovar/editar/enviar pelo chat-window.
 *
 * Falhas são logadas mas nunca propagam: o webhook precisa responder
 * 200 pra Meta mesmo se o agente quebrar.
 */

import { metaWhatsApp } from "@/lib/meta-whatsapp/client";
import {
  computeTypingDelayMs,
  isWithinBusinessHours,
  matchHandoffKeyword,
  normalizeBusinessHours,
  renderTemplate,
  type HandoffMode,
} from "@/lib/ai-agents/piloting";
import { prisma } from "@/lib/prisma";
import { sseBus } from "@/lib/sse-bus";
import {
  executeAgentHandoff,
  hasAgentGreetedInCurrentAssignment,
  markAgentGreetedNow,
  sendAgentMessage,
} from "@/services/ai/piloting-actions";
import { runAgent } from "@/services/ai/runner";

export type InboundAIArgs = {
  conversationId: string;
  contactId: string;
  userMessage: string;
  channel: "meta" | "baileys";
};

export async function maybeReplyAsAIAgent(args: InboundAIArgs): Promise<void> {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: args.conversationId },
      select: {
        id: true,
        assignedToId: true,
        contactId: true,
      },
    });
    if (!conversation?.assignedToId) return;

    const assignee = await prisma.user.findUnique({
      where: { id: conversation.assignedToId },
      select: {
        id: true,
        type: true,
        aiAgentConfig: {
          select: {
            id: true,
            active: true,
            autonomyMode: true,
            openingMessage: true,
            openingDelayMs: true,
            keywordHandoffs: true,
            inactivityHandoffMode: true,
            inactivityHandoffUserId: true,
            businessHours: true,
            simulateTyping: true,
            typingPerCharMs: true,
            markMessagesRead: true,
          },
        },
      },
    });
    if (!assignee || assignee.type !== "AI") return;
    if (!assignee.aiAgentConfig?.active) return;

    const cfg = assignee.aiAgentConfig;
    const humanBehavior = {
      simulateTyping: cfg.simulateTyping,
      typingPerCharMs: cfg.typingPerCharMs,
      markMessagesRead: cfg.markMessagesRead,
    };

    const openDeal = await prisma.deal.findFirst({
      where: { contactId: args.contactId, status: "OPEN" },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });

    // ── 1. Business hours gate ────────────────────────────────
    const businessHours = normalizeBusinessHours(cfg.businessHours);
    if (businessHours?.enabled && !isWithinBusinessHours(businessHours)) {
      if (businessHours.offHoursMessage?.trim()) {
        const contact = await prisma.contact.findUnique({
          where: { id: args.contactId },
          select: { name: true },
        });
        const text = renderTemplate(businessHours.offHoursMessage, {
          contactName: contact?.name ?? null,
        });
        await sendAgentMessage({
          conversationId: args.conversationId,
          contactId: args.contactId,
          agentUserId: assignee.id,
          autonomyMode: cfg.autonomyMode,
          text,
          channel: args.channel,
          kind: "off_hours",
          humanBehavior,
        }).catch(() => null);
      }
      return;
    }

    // ── 2. Keyword handoff ────────────────────────────────────
    const keyword = matchHandoffKeyword(
      args.userMessage,
      cfg.keywordHandoffs ?? [],
    );
    if (keyword) {
      await executeAgentHandoff({
        conversationId: args.conversationId,
        contactId: args.contactId,
        dealId: openDeal?.id ?? null,
        agentId: cfg.id,
        agentUserId: assignee.id,
        mode: (cfg.inactivityHandoffMode as HandoffMode) ?? "KEEP_OWNER",
        specificUserId: cfg.inactivityHandoffUserId ?? null,
        reason: `Palavra-chave disparou handoff: "${keyword}"`,
      });
      return;
    }

    // ── 3. Opening message (primeira resposta da conversa) ────
    // Usa `Conversation.aiGreetedAt` em vez do histórico de mensagens
    // pra que saudações disparem a cada nova atribuição ao agente IA,
    // mesmo que ele já tenha respondido algo nesta mesma conversa antes.
    if (cfg.openingMessage?.trim()) {
      const alreadyGreeted = await hasAgentGreetedInCurrentAssignment(
        args.conversationId,
      );
      if (!alreadyGreeted) {
        const [contact, deal] = await Promise.all([
          prisma.contact.findUnique({
            where: { id: args.contactId },
            select: { name: true },
          }),
          openDeal
            ? prisma.deal.findUnique({
                where: { id: openDeal.id },
                select: {
                  title: true,
                  stage: { select: { name: true } },
                },
              })
            : Promise.resolve(null),
        ]);
        const greeting = renderTemplate(cfg.openingMessage, {
          contactName: contact?.name ?? null,
          dealTitle: deal?.title ?? null,
          stageName: deal?.stage?.name ?? null,
        });
        if (cfg.openingDelayMs > 0) {
          await delay(Math.min(cfg.openingDelayMs, 10_000));
        }
        const greetResult = await sendAgentMessage({
          conversationId: args.conversationId,
          contactId: args.contactId,
          agentUserId: assignee.id,
          autonomyMode: cfg.autonomyMode,
          text: greeting,
          channel: args.channel,
          kind: "greeting",
          humanBehavior,
        }).catch(() => null);
        // Marca que cumprimentou tanto em envio real quanto em rascunho
        // — o rascunho é decisão do humano mandar, mas do ponto de vista
        // do agente "já cumprimentou" pra não duplicar.
        if (greetResult && greetResult.status !== "skipped") {
          await markAgentGreetedNow(args.conversationId);
        }
      }
    }

    // ── 4. Roda o LLM normalmente ─────────────────────────────
    const result = await runAgent({
      agentId: cfg.id,
      source: "inbox",
      userMessage: args.userMessage,
      conversationId: args.conversationId,
      contactId: args.contactId,
      dealId: openDeal?.id ?? null,
    });

    if (result.status === "FAILED") {
      console.warn(
        `[ai-inbox] runner falhou conv=${args.conversationId}: ${result.error}`,
      );
      return;
    }

    // Handoff: o runner já desatribuiu a conversa dentro da tool. Nada
    // mais a fazer aqui; o atendente humano receberá via SSE.
    if (result.status === "HANDOFF") {
      // Registra uma nota privada pra contextualizar o operador.
      if (result.text) {
        await prisma.message
          .create({
            data: {
              conversationId: args.conversationId,
              content: `[IA → humano] ${result.text}`,
              direction: "out",
              messageType: "note",
              isPrivate: true,
              authorType: "bot",
              aiAgentUserId: assignee.id,
              senderName: "Agente IA",
              sendStatus: "sent",
            },
          })
          .catch(() => null);
      }
      return;
    }

    const text = result.text.trim();
    if (!text) return;

    if (result.autonomyMode === "AUTONOMOUS" && args.channel === "meta") {
      if (!metaWhatsApp.configured) {
        console.warn("[ai-inbox] Meta não configurado; gravando como rascunho.");
        await saveDraft(assignee.id, args.conversationId, text);
        return;
      }
      const contact = await prisma.contact.findUnique({
        where: { id: args.contactId },
        select: { phone: true },
      });
      if (!contact?.phone) {
        await saveDraft(assignee.id, args.conversationId, text);
        return;
      }

      // ── Comportamento humano: typing/read antes da resposta do LLM ──
      // Mesma lógica de sendAgentMessage — duplicada aqui porque o
      // fluxo autônomo final grava Message direto (não passa pelo
      // piloting-actions).
      await applyHumanBehaviorBeforeSend({
        conversationId: args.conversationId,
        text,
        humanBehavior,
      });

      let externalId: string | null = null;
      try {
        const send = await metaWhatsApp.sendText(contact.phone, text);
        externalId = send.messages?.[0]?.id ?? null;
      } catch (err) {
        console.error(
          `[ai-inbox] Falha ao enviar resposta autônoma: ${err}. Salvando rascunho pro humano revisar.`,
        );
        await saveDraft(assignee.id, args.conversationId, text);
        return;
      }
      const saved = await prisma.message.create({
        data: {
          conversationId: args.conversationId,
          content: text,
          direction: "out",
          messageType: "text",
          authorType: "bot",
          aiAgentUserId: assignee.id,
          senderName: "Agente IA",
          externalId,
          sendStatus: "sent",
        },
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
        conversationId: args.conversationId,
        contactId: args.contactId,
        direction: "out",
        content: text,
        timestamp: saved.createdAt,
      });
      return;
    }

    await saveDraft(assignee.id, args.conversationId, text);
  } catch (err) {
    console.error("[ai-inbox] erro não-fatal:", err);
  }
}

async function saveDraft(
  agentUserId: string,
  conversationId: string,
  text: string,
) {
  const saved = await prisma.message.create({
    data: {
      conversationId,
      content: text,
      direction: "out",
      messageType: "ai_draft",
      authorType: "bot",
      isPrivate: true,
      aiAgentUserId: agentUserId,
      senderName: "Agente IA (rascunho)",
      sendStatus: "draft",
    },
  });
  sseBus.publish("new_message", {
    conversationId,
    direction: "out",
    messageType: "ai_draft",
    content: text,
    timestamp: saved.createdAt,
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Aplica "digitando..." e/ou "lido" (status=read) no WhatsApp do
 * cliente antes do agente responder. Falhas são engolidas: os
 * endpoints Meta têm janelas estreitas de validade (~30s) e não
 * devemos bloquear o envio da resposta real por causa disso.
 */
async function applyHumanBehaviorBeforeSend(args: {
  conversationId: string;
  text: string;
  humanBehavior: {
    simulateTyping: boolean;
    typingPerCharMs: number;
    markMessagesRead: boolean;
  };
}): Promise<void> {
  const { simulateTyping, typingPerCharMs, markMessagesRead } =
    args.humanBehavior;
  if (!simulateTyping && !markMessagesRead) return;

  const inbound = await prisma.message.findFirst({
    where: {
      conversationId: args.conversationId,
      direction: "in",
      externalId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { externalId: true },
  });
  const wamid = inbound?.externalId;
  if (!wamid) return;

  if (simulateTyping) {
    // sendTypingIndicator já marca como lida no mesmo request.
    await metaWhatsApp.sendTypingIndicator(wamid);
    const delayMs = computeTypingDelayMs(args.text.length, typingPerCharMs);
    await delay(delayMs);
    return;
  }

  if (markMessagesRead) {
    try {
      await metaWhatsApp.markAsRead(wamid);
    } catch (err) {
      console.warn(
        "[ai-inbox] markAsRead falhou:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}
