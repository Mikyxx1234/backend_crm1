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

import { metaClientFromConfig, type MetaWhatsAppClient } from "@/lib/meta-whatsapp/client";
import {
  computeTypingDelayMs,
  isWithinBusinessHours,
  matchHandoffKeyword,
  normalizeBusinessHours,
  renderTemplate,
} from "@/lib/ai-agents/piloting";
import { cache } from "@/lib/cache";
import { prisma } from "@/lib/prisma";
import { getOrgIdOrNull } from "@/lib/request-context";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { sseBus } from "@/lib/sse-bus";
import {
  hasAgentGreetedInCurrentAssignment,
  markAgentGreetedNow,
  sendAgentMessage,
} from "@/services/ai/piloting-actions";
import { isContactAllowedForAi } from "@/services/ai/phone-allowlist";
import { executeAcademicDepartmentHandoff } from "@/services/ai/academic-department-routing";
import {
  LOW_CONFIDENCE_HANDOFF_MESSAGE,
  parseAgentConfidence,
  shouldHandoffOnLowConfidence,
} from "@/services/ai/confidence";
import { runAgent } from "@/services/ai/runner";

export type InboundAIArgs = {
  conversationId: string;
  contactId: string;
  userMessage: string;
  channel: "meta" | "baileys";
  /** Geração do debounce — se supersedida, aborta antes do envio. */
  generationId?: string;
  inboundMessageIds?: string[];
};

function logAi(event: string, payload: Record<string, unknown>) {
  console.info(
    "[ai-attend]",
    JSON.stringify({ event, ts: new Date().toISOString(), ...payload }),
  );
}

/**
 * Confirma que a conversa ainda está com um agente IA ativo e que
 * nenhum humano respondeu depois do início do processamento.
 */
export async function assertAiStillAuthorized(args: {
  conversationId: string;
  expectedAgentUserId: string;
  generationId?: string;
  since?: Date;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (args.generationId) {
    const current = await cache.get<string>(`ai:gen:${args.conversationId}`);
    if (current && current !== args.generationId) {
      return { ok: false, reason: "generation_superseded" };
    }
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: args.conversationId },
    select: {
      assignedToId: true,
      hasHumanReply: true,
      assignedTo: { select: { type: true } },
    },
  });
  if (!conversation?.assignedToId) {
    return { ok: false, reason: "unassigned" };
  }
  if (conversation.assignedToId !== args.expectedAgentUserId) {
    return { ok: false, reason: "assignee_changed" };
  }
  if (conversation.assignedTo?.type !== "AI") {
    return { ok: false, reason: "assignee_not_ai" };
  }

  // Humano falou depois do início deste processamento?
  if (args.since) {
    const humanOut = await prisma.message.findFirst({
      where: {
        conversationId: args.conversationId,
        direction: "out",
        authorType: "human",
        isPrivate: false,
        createdAt: { gte: args.since },
      },
      select: { id: true },
    });
    if (humanOut) return { ok: false, reason: "human_replied_during_run" };
  } else if (conversation.hasHumanReply) {
    // Heurística: se a última outbound é humana, bloqueia.
    const lastOut = await prisma.message.findFirst({
      where: {
        conversationId: args.conversationId,
        direction: "out",
        isPrivate: false,
        messageType: { not: "note" },
      },
      orderBy: { createdAt: "desc" },
      select: { authorType: true },
    });
    if (lastOut?.authorType === "human") {
      return { ok: false, reason: "human_last_outbound" };
    }
  }

  return { ok: true };
}

export async function maybeReplyAsAIAgent(args: InboundAIArgs): Promise<void> {
  const startedAt = new Date();
  try {
    // Defesa em profundidade: nunca envia se telefone fora da allowlist.
    try {
      const allowed = await isContactAllowedForAi(args.contactId);
      if (!allowed) {
        logAi("blocked", {
          conversationId: args.conversationId,
          contactId: args.contactId,
          reason: "phone_allowlist",
        });
        return;
      }
    } catch (e) {
      console.error("[ai] phone allowlist in maybeReply — blocking", e);
      return;
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: args.conversationId },
      select: {
        id: true,
        assignedToId: true,
        contactId: true,
        hasHumanReply: true,
        channelRef: { select: { id: true, config: true } },
      },
    });
    if (!conversation?.assignedToId) {
      logAi("blocked", {
        conversationId: args.conversationId,
        reason: "no_assignee",
      });
      return;
    }

    const channelConfig = conversation.channelRef?.config as
      | Record<string, unknown>
      | null
      | undefined;
    const metaClient: MetaWhatsAppClient = metaClientFromConfig(channelConfig);

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
            model: true,
          },
        },
      },
    });
    if (!assignee || assignee.type !== "AI") {
      logAi("blocked", {
        conversationId: args.conversationId,
        reason: "assignee_not_ai",
      });
      return;
    }
    if (!assignee.aiAgentConfig?.active) {
      logAi("blocked", {
        conversationId: args.conversationId,
        reason: "agent_inactive",
        agentUserId: assignee.id,
      });
      return;
    }

    // Se a última outbound é humana, não compete com o atendente.
    const lastOut = await prisma.message.findFirst({
      where: {
        conversationId: args.conversationId,
        direction: "out",
        isPrivate: false,
        messageType: { not: "note" },
      },
      orderBy: { createdAt: "desc" },
      select: { authorType: true, createdAt: true },
    });
    if (lastOut?.authorType === "human") {
      logAi("blocked", {
        conversationId: args.conversationId,
        reason: "human_last_outbound",
        agentUserId: assignee.id,
      });
      return;
    }

    const cfg = assignee.aiAgentConfig;
    const humanBehavior = {
      simulateTyping: cfg.simulateTyping,
      typingPerCharMs: cfg.typingPerCharMs,
      markMessagesRead: cfg.markMessagesRead,
    };

    logAi("run_start", {
      conversationId: args.conversationId,
      contactId: args.contactId,
      channel: args.channel,
      generationId: args.generationId ?? null,
      inboundMessageIds: args.inboundMessageIds ?? [],
      model: cfg.model,
      agentUserId: assignee.id,
    });

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
        const auth = await assertAiStillAuthorized({
          conversationId: args.conversationId,
          expectedAgentUserId: assignee.id,
          generationId: args.generationId,
          since: startedAt,
        });
        if (!auth.ok) {
          logAi("blocked", {
            conversationId: args.conversationId,
            reason: auth.reason,
            phase: "pre_off_hours_send",
          });
          return;
        }
        await sendAgentMessage({
          conversationId: args.conversationId,
          contactId: args.contactId,
          agentUserId: assignee.id,
          autonomyMode: cfg.autonomyMode,
          text,
          channel: args.channel,
          kind: "off_hours",
          humanBehavior,
          generationId: args.generationId,
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
      await executeAcademicDepartmentHandoff({
        conversationId: args.conversationId,
        contactId: args.contactId,
        dealId: openDeal?.id ?? null,
        userMessage: args.userMessage,
        reason: `Palavra-chave disparou handoff: "${keyword}"`,
      });
      logAi("handoff", {
        conversationId: args.conversationId,
        reason: "keyword",
        keyword,
      });
      return;
    }

    // ── 3. Opening message (primeira resposta da conversa) ────
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
        const authGreet = await assertAiStillAuthorized({
          conversationId: args.conversationId,
          expectedAgentUserId: assignee.id,
          generationId: args.generationId,
          since: startedAt,
        });
        if (!authGreet.ok) {
          logAi("blocked", {
            conversationId: args.conversationId,
            reason: authGreet.reason,
            phase: "pre_greeting_send",
          });
          return;
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
          generationId: args.generationId,
        }).catch(() => null);
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
      logAi("run_failed", {
        conversationId: args.conversationId,
        error: result.error ?? "unknown",
        durationMs: Date.now() - startedAt.getTime(),
      });
      return;
    }

    if (result.status === "HANDOFF") {
      if (result.text) {
        await prisma.message
          .create({
            data: withOrgFromCtx({
              conversationId: args.conversationId,
              content: `[IA → humano] ${result.text}`,
              direction: "out",
              messageType: "note",
              isPrivate: true,
              authorType: "bot",
              aiAgentUserId: assignee.id,
              senderName: "Agente IA",
              sendStatus: "sent",
            }),
          })
          .catch(() => null);
      }
      logAi("handoff", {
        conversationId: args.conversationId,
        reason: "tool_transfer",
        durationMs: Date.now() - startedAt.getTime(),
      });
      return;
    }

    const parsed = parseAgentConfidence(result.text.trim());
    let text = parsed.text;
    // Persiste a confiança auto-declarada no run (métrica de qualidade).
    if (parsed.confidence !== null) {
      await prisma.aIAgentRun
        .update({
          where: { id: result.runId },
          data: { confidence: parsed.confidence },
        })
        .catch(() => null);
    }
    if (!text && !shouldHandoffOnLowConfidence(parsed.confidence)) {
      logAi("empty_reply", {
        conversationId: args.conversationId,
        durationMs: Date.now() - startedAt.getTime(),
      });
      return;
    }

    // Paridade DataCrazy: confiança < 0.40 → mensagem neutra + handoff
    // (não envia chute do LLM; não usa execute_distribution).
    if (shouldHandoffOnLowConfidence(parsed.confidence)) {
      const authLow = await assertAiStillAuthorized({
        conversationId: args.conversationId,
        expectedAgentUserId: assignee.id,
        generationId: args.generationId,
        since: startedAt,
      });
      if (!authLow.ok) {
        logAi("blocked", {
          conversationId: args.conversationId,
          reason: authLow.reason,
          phase: "pre_low_conf_handoff",
        });
        return;
      }
      await sendAgentMessage({
        conversationId: args.conversationId,
        contactId: args.contactId,
        agentUserId: assignee.id,
        autonomyMode: cfg.autonomyMode,
        text: LOW_CONFIDENCE_HANDOFF_MESSAGE,
        channel: args.channel,
        kind: "text",
        humanBehavior,
        generationId: args.generationId,
      }).catch(() => null);
      await executeAcademicDepartmentHandoff({
        conversationId: args.conversationId,
        contactId: args.contactId,
        dealId: openDeal?.id ?? null,
        userMessage: args.userMessage,
        reason: `Baixa confiança da IA (${parsed.confidence?.toFixed(2)})`,
      });
      await prisma.aIAgentRun
        .update({
          where: { id: result.runId },
          data: { status: "HANDOFF", handoffReason: "low_confidence" },
        })
        .catch(() => null);
      logAi("handoff", {
        conversationId: args.conversationId,
        reason: "low_confidence",
        confidence: parsed.confidence,
        durationMs: Date.now() - startedAt.getTime(),
      });
      return;
    }

    if (!text) {
      logAi("empty_reply", {
        conversationId: args.conversationId,
        durationMs: Date.now() - startedAt.getTime(),
      });
      return;
    }

    // Revalida ANTES de enviar (humano pode ter assumido durante o LLM).
    const auth = await assertAiStillAuthorized({
      conversationId: args.conversationId,
      expectedAgentUserId: assignee.id,
      generationId: args.generationId,
      since: startedAt,
    });
    if (!auth.ok) {
      logAi("blocked", {
        conversationId: args.conversationId,
        reason: auth.reason,
        phase: "pre_send",
        durationMs: Date.now() - startedAt.getTime(),
      });
      return;
    }

    if (result.autonomyMode === "AUTONOMOUS" && args.channel === "meta") {
      if (!metaClient.configured) {
        console.warn("[ai-inbox] Meta não configurado para este canal; gravando como rascunho.");
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

      await applyHumanBehaviorBeforeSend({
        conversationId: args.conversationId,
        text,
        humanBehavior,
        metaClient,
      });

      // Segunda revalidação após typing delay.
      const auth2 = await assertAiStillAuthorized({
        conversationId: args.conversationId,
        expectedAgentUserId: assignee.id,
        generationId: args.generationId,
        since: startedAt,
      });
      if (!auth2.ok) {
        logAi("blocked", {
          conversationId: args.conversationId,
          reason: auth2.reason,
          phase: "pre_send_after_typing",
        });
        return;
      }

      let externalId: string | null = null;
      try {
        const send = await metaClient.sendText(contact.phone, text);
        externalId = send.messages?.[0]?.id ?? null;
      } catch (err) {
        console.error(
          `[ai-inbox] Falha ao enviar resposta autônoma: ${err}. Salvando rascunho pro humano revisar.`,
        );
        logAi("send_failed", {
          conversationId: args.conversationId,
          error: err instanceof Error ? err.message : String(err),
        });
        await saveDraft(assignee.id, args.conversationId, text);
        return;
      }
      const saved = await prisma.message.create({
        data: withOrgFromCtx({
          conversationId: args.conversationId,
          content: text,
          direction: "out",
          messageType: "text",
          authorType: "bot",
          aiAgentUserId: assignee.id,
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
      logAi("send_ok", {
        conversationId: args.conversationId,
        messageId: saved.id,
        channel: "meta",
        model: cfg.model,
        durationMs: Date.now() - startedAt.getTime(),
      });
      return;
    }

    // Baileys / draft path via sendAgentMessage (com revalidação interna).
    if (result.autonomyMode === "AUTONOMOUS" && args.channel === "baileys") {
      const sendResult = await sendAgentMessage({
        conversationId: args.conversationId,
        contactId: args.contactId,
        agentUserId: assignee.id,
        autonomyMode: cfg.autonomyMode,
        text,
        channel: "baileys",
        humanBehavior,
        generationId: args.generationId,
      });
      logAi("send_result", {
        conversationId: args.conversationId,
        status: sendResult.status,
        channel: "baileys",
        durationMs: Date.now() - startedAt.getTime(),
      });
      return;
    }

    await saveDraft(assignee.id, args.conversationId, text);
    logAi("draft_saved", {
      conversationId: args.conversationId,
      durationMs: Date.now() - startedAt.getTime(),
    });
  } catch (err) {
    console.error("[ai-inbox] erro não-fatal:", err);
    logAi("run_error", {
      conversationId: args.conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function saveDraft(
  agentUserId: string,
  conversationId: string,
  text: string,
) {
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
  metaClient: MetaWhatsAppClient;
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
    await args.metaClient.sendTypingIndicator(wamid);
    const delayMs = computeTypingDelayMs(args.text.length, typingPerCharMs);
    await delay(delayMs);
    return;
  }

  if (markMessagesRead) {
    try {
      await args.metaClient.markAsRead(wamid);
    } catch (err) {
      console.warn(
        "[ai-inbox] markAsRead falhou:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}
