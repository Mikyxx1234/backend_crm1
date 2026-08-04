/**
 * Envio outbound reutilizável (nota interna, texto WhatsApp e template Meta),
 * desacoplado de `Request`/`NextResponse`.
 *
 * Motivo: até 03/ago/26 a única forma de enviar template era o handler
 * `POST /api/conversations/:id/template`, que só aceitava sessão NextAuth.
 * Integrações (node do n8n) precisavam do mesmo comportamento por Bearer e
 * a partir de um `dealId`, não de um `conversationId`. Duplicar o handler
 * criaria duas verdades sobre "o que acontece ao enviar" (SSE, reabertura de
 * ticket, cancelamento de agendamento, activity log). Então a lógica vive
 * aqui e ambas as rotas são cascas finas.
 *
 * Retorno em vez de exceção: `{ ok: false, status, message }` permite que a
 * rota traduza para HTTP sem que o service conheça Next.js — e mantém o
 * service testável fora do runtime de rota.
 */

import type { NextResponse } from "next/server";

import { requireChannelScope } from "@/lib/authz/resource-policy";
import { getContactWhatsAppTargets } from "@/lib/contact-whatsapp-target";
import { analyzeTemplateComponents } from "@/lib/meta-whatsapp/analyze-template-components";
import {
  renderTemplatePreview,
  type TemplateVariableInput,
} from "@/lib/meta-whatsapp/build-template-components";
import { metaClientFromConfig } from "@/lib/meta-whatsapp/client";
import { enrichTemplateComponentsForFlowSend } from "@/lib/meta-whatsapp/enrich-template-flow";
import { resolveOutboundChannel } from "@/lib/outbound-channel";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { isBaileysChannel, sendWhatsAppText } from "@/lib/send-whatsapp";
import { sseBus } from "@/lib/sse-bus";
import { buildOutboundTemplateMessageContent } from "@/lib/whatsapp-outbound-template-label";
import { logEvent } from "@/services/activity-log";
import { cancelActiveContextsForContact } from "@/services/automation-context";
import { fireTrigger } from "@/services/automation-triggers";
import { getConversationLite, reopenResolvedAsNewTicket } from "@/services/conversations";
import { cancelPendingForConversation } from "@/services/scheduled-messages";

export type OutboundActor = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  organizationId: string | null;
  isSuperAdmin?: boolean;
};

export type OutboundMessageDto = {
  id: string;
  content: string;
  createdAt: string;
  direction: "out";
  messageType: string;
  isPrivate?: boolean;
  senderName: string;
  externalId?: string | null;
};

export type OutboundFailure = { ok: false; status: number; message: string };

export type OutboundSuccess = {
  ok: true;
  message: OutboundMessageDto;
  conversationId: string;
  /** Preenchido quando a conversa estava encerrada e virou um ticket novo. */
  reopenedConversationId?: string;
  /** Erro reportado pela Meta sem impedir a persistência da mensagem. */
  metaError?: string;
};

export type OutboundResult = OutboundSuccess | OutboundFailure;

function actorName(actor: OutboundActor): string {
  return actor.name?.trim() || actor.email?.trim() || "Agente";
}

/**
 * Converte o `NextResponse` de negação das policies em `OutboundFailure`.
 * As policies são compartilhadas com as rotas e já retornam HTTP, então
 * lemos o corpo em vez de reimplementar as regras de autorização aqui.
 */
async function denialToFailure(denied: NextResponse): Promise<OutboundFailure> {
  let message = "Acesso negado.";
  try {
    const body = (await denied.json()) as { message?: unknown };
    if (typeof body?.message === "string" && body.message.trim()) {
      message = body.message;
    }
  } catch {
    // resposta sem corpo JSON: mantém a mensagem padrão
  }
  return { ok: false, status: denied.status, message };
}

type ConversationLite = NonNullable<Awaited<ReturnType<typeof getConversationLite>>>;

/**
 * Regra "reabrir = novo id": responder em conversa RESOLVED cria um ticket
 * novo. Notas internas não reabrem — são anotações do ticket encerrado.
 */
async function reopenIfResolved(
  conv: ConversationLite,
): Promise<{ conv: ConversationLite; reopenedConversationId: string | null }> {
  if (conv.status !== "RESOLVED" || !conv.contactId) {
    return { conv, reopenedConversationId: null };
  }
  const reopened = await reopenResolvedAsNewTicket(conv.id);
  if (reopened.id === conv.id) return { conv, reopenedConversationId: null };
  const fresh = await getConversationLite(reopened.id);
  if (!fresh) return { conv, reopenedConversationId: null };
  if (reopened.created) {
    void logEvent({
      type: "CONVERSATION_CREATED",
      entityType: "CONVERSATION",
      entityId: fresh.id,
      entityLabel: null,
      conversationId: fresh.id,
      contactId: fresh.contactId,
      meta: {
        channel: fresh.channel,
        source: "outbound_reopen",
        previousConversationId: conv.id,
      },
    });
  }
  return { conv: fresh, reopenedConversationId: fresh.id };
}

function publishNewMessage(
  conv: Pick<ConversationLite, "id" | "organizationId" | "contactId">,
  content: string,
  timestamp: Date,
): void {
  try {
    sseBus.publish("new_message", {
      organizationId: conv.organizationId,
      conversationId: conv.id,
      contactId: conv.contactId,
      direction: "out",
      content,
      timestamp,
    });
  } catch {
    // best-effort: nunca derruba o envio por falha de SSE
  }
}

// ── Nota interna ─────────────────────────────

/**
 * Cria nota interna na conversa (`messageType=note`, `isPrivate=true`) e
 * espelha em `Note`, para aparecer tanto na timeline do /inbox quanto na aba
 * "Notas" do deal em /pipeline. Não toca no canal — nada é enviado ao cliente.
 */
export async function createInternalNoteOnConversation(args: {
  conversationId: string;
  actor: OutboundActor;
  content: string;
  /** Vincula a nota a um deal específico; sem isso resolvemos o deal aberto. */
  dealId?: string | null;
}): Promise<OutboundResult> {
  const content = args.content.trim();
  if (!content) return { ok: false, status: 400, message: "Mensagem vazia." };

  const conv = await getConversationLite(args.conversationId);
  if (!conv) return { ok: false, status: 404, message: "Conversa não encontrada." };

  const senderName = actorName(args.actor);
  const saved = await prisma.message.create({
    data: withOrgFromCtx({
      conversationId: conv.id,
      content,
      direction: "out",
      messageType: "note",
      isPrivate: true,
      senderName,
    }),
  });

  void (async () => {
    const dealId =
      args.dealId ??
      (conv.contactId
        ? (
            await prisma.deal
              .findFirst({
                where: { contactId: conv.contactId, status: "OPEN" },
                select: { id: true },
                orderBy: { updatedAt: "desc" },
              })
              .catch(() => null)
          )?.id ?? null
        : null);

    if (conv.contactId || dealId) {
      await prisma.note
        .create({
          data: withOrgFromCtx({
            content,
            contactId: conv.contactId ?? undefined,
            dealId: dealId ?? undefined,
            userId: args.actor.id,
          }),
        })
        .catch(() => null);
    }

    await logEvent({
      type: "NOTE_ADDED",
      entityType: "MESSAGE",
      entityId: saved.id,
      entityLabel: senderName,
      conversationId: conv.id,
      contactId: conv.contactId,
      dealId,
      meta: { preview: content.slice(0, 200), source: "outbound_service", isPrivate: true },
    });
  })();

  publishNewMessage(conv, content, saved.createdAt);

  return {
    ok: true,
    conversationId: conv.id,
    message: {
      id: saved.id,
      content,
      createdAt: saved.createdAt.toISOString(),
      direction: "out",
      messageType: "note",
      isPrivate: true,
      senderName,
    },
  };
}

// ── Texto WhatsApp ───────────────────────────

/**
 * Envia texto livre na conversa de WhatsApp (Meta Cloud API ou Baileys).
 *
 * Escopo deliberadamente restrito a WhatsApp: Messenger e Instagram têm
 * identificadores e endpoints próprios e continuam exclusivos do composer do
 * inbox (`POST /api/conversations/:id/messages`), que já trata esses casos.
 */
export async function sendTextToConversation(args: {
  conversationId: string;
  actor: OutboundActor;
  content: string;
  /** Override do canal de saída quando a org tem mais de um WhatsApp. */
  channelId?: string | null;
  /**
   * Encerra automações ativas do contato, como faz a resposta de um operador.
   * Default `true` (paridade com o composer do inbox): sem isso, um salesbot
   * em andamento continuaria mandando mensagens sobrepostas ao envio.
   * Integrações que orquestram o fluxo por fora podem desligar.
   */
  stopAutomations?: boolean;
}): Promise<OutboundResult> {
  const content = args.content.trim();
  if (!content) return { ok: false, status: 400, message: "Mensagem vazia." };

  const found = await getConversationLite(args.conversationId);
  if (!found) return { ok: false, status: 404, message: "Conversa não encontrada." };

  if (found.channel !== "whatsapp") {
    return {
      ok: false,
      status: 400,
      message: `Envio de texto por esta rota é exclusivo de WhatsApp (canal da conversa: ${found.channel}).`,
    };
  }

  const { conv, reopenedConversationId } = await reopenIfResolved(found);

  const sendDenied = await requireChannelScope(
    { id: args.actor.id, role: args.actor.role ?? undefined, organizationId: args.actor.organizationId, isSuperAdmin: args.actor.isSuperAdmin },
    "send",
    conv.channelId,
  );
  if (sendDenied) return denialToFailure(sendDenied);

  const resolved = await resolveOutboundChannel({
    conv: {
      channelId: conv.channelId,
      channelRef: conv.channelRef,
      organizationId: conv.organizationId,
    },
    user: {
      id: args.actor.id,
      role: args.actor.role ?? null,
      organizationId: args.actor.organizationId,
      isSuperAdmin: args.actor.isSuperAdmin,
    },
    requestedChannelId: args.channelId ?? null,
  });
  if (!resolved.ok) return denialToFailure(resolved.response);

  const outboundChannelRef = resolved.channelRef;
  const outboundChannelId = resolved.channelId;
  const useBaileys = isBaileysChannel(outboundChannelRef);
  const channelConfig = outboundChannelRef?.config as Record<string, unknown> | null | undefined;
  // Sem canal Meta configurado: persiste localmente (dev/mock) em vez de 500.
  const localOnly = !useBaileys && !metaClientFromConfig(channelConfig).configured;

  if (!useBaileys && !localOnly) {
    const target = await getContactWhatsAppTargets(conv.contactId ?? "");
    if (!target) {
      return {
        ok: false,
        status: 400,
        message: "Contato sem telefone nem BSUID WhatsApp (Meta).",
      };
    }
  }

  const senderName = actorName(args.actor);
  const saved = await prisma.message.create({
    data: withOrgFromCtx({
      conversationId: conv.id,
      channelId: outboundChannelId ?? undefined,
      content,
      direction: "out",
      messageType: "text",
      senderName,
      ...(localOnly ? { sendStatus: "sent" } : {}),
    }),
  });

  const sendResult = localOnly
    ? { externalId: null as string | null, failed: false, error: undefined as string | undefined }
    : await sendWhatsAppText({
        conversationId: conv.id,
        contactId: conv.contactId,
        channelRef: outboundChannelRef,
        content,
        messageId: saved.id,
        waJid: conv.waJid,
      });

  try {
    await prisma.conversation.update({
      where: { id: conv.id },
      data: {
        lastMessageDirection: "out",
        hasAgentReply: true,
        hasError: sendResult.failed,
      },
    });
  } catch {
    // colunas opcionais em bases antigas
  }

  if (!sendResult.failed) {
    void logEvent({
      type: "MESSAGE_SENT",
      entityType: "MESSAGE",
      entityId: saved.id,
      entityLabel: senderName,
      conversationId: conv.id,
      contactId: conv.contactId,
      meta: {
        preview: content.slice(0, 200),
        channel: "WhatsApp",
        via: useBaileys ? "baileys" : localOnly ? "local" : "meta",
        externalId: sendResult.externalId,
      },
    });
  }

  publishNewMessage(conv, content, saved.createdAt);
  await afterOutboundSideEffects(conv, args.actor.id, content, args.stopAutomations !== false);

  return {
    ok: true,
    conversationId: conv.id,
    ...(reopenedConversationId ? { reopenedConversationId } : {}),
    ...(sendResult.error ? { metaError: sendResult.error } : {}),
    message: {
      id: saved.id,
      content,
      createdAt: saved.createdAt.toISOString(),
      direction: "out",
      messageType: "text",
      senderName,
      externalId: sendResult.externalId,
    },
  };
}

// ── Template Meta ────────────────────────────

export type SendTemplateArgs = {
  conversationId: string;
  actor: OutboundActor;
  templateName: string;
  /** Ausente = idioma declarado no próprio template; se indisponível, pt_BR. */
  languageCode?: string | null;
  /** Array no formato da Cloud API. Já montado por `buildTemplateComponents`. */
  components?: unknown[] | null;
  /** Corpo renderizado, usado como texto da mensagem salva na timeline. */
  bodyPreview?: string | null;
  /**
   * Variáveis preenchidas. Só servem para renderizar o preview quando
   * `bodyPreview` não é informado — o payload enviado à Meta vem de
   * `components`. Integrações mandam as duas coisas derivadas das mesmas
   * variáveis; a UI já manda `bodyPreview` pronto.
   */
  templateVariables?: TemplateVariableInput[] | null;
  templateGraphId?: string | null;
  flowToken?: string | null;
  flowActionData?: Record<string, unknown> | null;
};

/**
 * Envia template aprovado da WABA na conversa.
 *
 * Extraído de `POST /api/conversations/:id/template` sem mudança de
 * comportamento — inclusive `strictFlowEnrich: false`, que mantém o envio de
 * templates simples funcionando quando a consulta da definição na Meta falha.
 */
export async function sendTemplateToConversation(
  args: SendTemplateArgs,
): Promise<OutboundResult> {
  const templateName = args.templateName.trim();
  if (!templateName) {
    return { ok: false, status: 400, message: "templateName é obrigatório." };
  }

  const findConvFull = (convId: string) =>
    prisma.conversation.findUnique({
      where: { id: convId },
      include: {
        contact: { select: { phone: true, whatsappBsuid: true } },
        // Config do canal resolve o cliente Meta correto por org — o
        // singleton de env rotearia todo mundo pelo primeiro número
        // configurado (leak entre tenants).
        channelRef: { select: { id: true, provider: true, config: true } },
      },
    });

  let conv = await findConvFull(args.conversationId);
  if (!conv) return { ok: false, status: 404, message: "Conversa não encontrada." };

  let reopenedConversationId: string | null = null;
  if (conv.status === "RESOLVED" && conv.contactId) {
    const reopened = await reopenResolvedAsNewTicket(conv.id);
    if (reopened.id !== conv.id) {
      const fresh = await findConvFull(reopened.id);
      if (fresh) {
        reopenedConversationId = reopened.id;
        conv = fresh;
      }
    }
  }

  const sendDenied = await requireChannelScope(
    { id: args.actor.id, role: args.actor.role ?? undefined, organizationId: args.actor.organizationId, isSuperAdmin: args.actor.isSuperAdmin },
    "send",
    conv.channelId,
  );
  if (sendDenied) return denialToFailure(sendDenied);

  if (conv.channelRef?.provider === "BAILEYS_MD") {
    return {
      ok: false,
      status: 400,
      message:
        "Templates não são suportados em canais WhatsApp QR (Baileys). Use mensagem de texto.",
    };
  }

  const digits = conv.contact?.phone?.replace(/\D/g, "") ?? "";
  const to = digits.length >= 8 ? digits : undefined;
  const recipient = conv.contact?.whatsappBsuid?.trim() || undefined;
  if (!to && !recipient) {
    return { ok: false, status: 400, message: "Contato sem telefone nem BSUID WhatsApp (Meta)." };
  }

  const channelConfig = conv.channelRef?.config as Record<string, unknown> | null | undefined;
  const metaClient = metaClientFromConfig(channelConfig);
  if (!metaClient.configured) {
    return {
      ok: false,
      status: 503,
      message:
        "Canal WhatsApp da conversa sem credenciais Meta (accessToken/phoneNumberId). Configure em Canais ou defina META_WHATSAPP_* no env.",
    };
  }

  const senderName = actorName(args.actor);

  let templateCategory: string | null = null;
  let templateGraphId: string | null = args.templateGraphId?.trim() || null;
  // Capturar o id da config é o que permite ao resolver de Flow inbound
  // identificar o flow certo quando a resposta volta.
  let templateConfigId: string | null = null;
  try {
    const cfg = await prisma.whatsAppTemplateConfig.findFirst({
      where: { metaTemplateName: templateName },
      select: { id: true, category: true, metaTemplateId: true },
    });
    templateCategory = cfg?.category ?? null;
    templateConfigId = cfg?.id ?? null;
    if (!templateGraphId && cfg?.metaTemplateId?.trim()) {
      templateGraphId = cfg.metaTemplateId.trim();
    }
  } catch {
    // config local é opcional — o template pode existir só na WABA
  }

  let bodyPreview = args.bodyPreview?.trim() || null;
  let languageCode = args.languageCode?.trim() || null;

  // Consulta a definição na Graph apenas quando ainda falta algo que só a
  // Meta sabe. Integrações mandam só o nome do template e as variáveis; a UI
  // já manda idioma e preview prontos e não paga essa chamada.
  if (!templateCategory || !languageCode || !bodyPreview) {
    const metaTemplates = (await metaClient
      .listMessageTemplates({ limit: 200 })
      .catch(() => null)) as {
      data?: {
        name: string;
        category?: string;
        language?: string;
        components?: unknown[];
        parameter_format?: string;
      }[];
    } | null;
    const match = metaTemplates?.data?.find((t) => t.name === templateName);
    if (match) {
      if (!templateCategory && match.category) templateCategory = match.category;
      if (!languageCode && match.language) languageCode = match.language;
      if (!bodyPreview) {
        const analysis = analyzeTemplateComponents(match.components, {
          parameterFormat: match.parameter_format ?? null,
        });
        bodyPreview =
          renderTemplatePreview(analysis.bodyText, args.templateVariables).trim() || null;
      }
    }
  }

  if (!languageCode) languageCode = "pt_BR";

  const content = buildOutboundTemplateMessageContent(
    templateName,
    "generic",
    templateCategory,
    bodyPreview,
  );

  let externalId: string | null = null;
  let resolvedFlowToken: string | null = null;
  try {
    const enrichResult = await enrichTemplateComponentsForFlowSend(metaClient, {
      templateName,
      languageCode,
      components: Array.isArray(args.components) ? args.components : undefined,
      flowToken: args.flowToken?.trim() || null,
      flowActionData: args.flowActionData ?? null,
      templateGraphId,
      strictFlowEnrich: false,
    });
    resolvedFlowToken = enrichResult.flowToken;
    const result = await metaClient.sendTemplate(
      to,
      templateName,
      languageCode,
      enrichResult.components,
      recipient,
    );
    externalId = result.messages?.[0]?.id ?? null;
    console.log(
      `[meta-send-template] template=${templateName} channel=${conv.channelRef?.id ?? "ENV"} to=${to ?? "—"}/${recipient ?? "—"} wamid=${externalId}`,
    );
  } catch (e: unknown) {
    console.error("[meta-send-template]", e);
    return {
      ok: false,
      status: 502,
      message: e instanceof Error ? e.message : "Falha ao enviar template pelo WhatsApp.",
    };
  }

  const saved = await prisma.message.create({
    data: withOrgFromCtx({
      conversationId: conv.id,
      channelId: conv.channelRef?.id ?? undefined,
      content,
      direction: "out",
      messageType: "template",
      senderName,
      ...(externalId ? { externalId } : {}),
      ...(resolvedFlowToken?.trim() ? { flowToken: resolvedFlowToken.trim() } : {}),
      ...(templateConfigId ? { templateConfigId } : {}),
    }),
  });

  publishNewMessage(conv, content, saved.createdAt);

  cancelPendingForConversation(conv.id, "agent_reply", args.actor.id).catch((err) =>
    console.warn("[scheduled-messages] falha ao cancelar apos envio de template:", err),
  );

  return {
    ok: true,
    conversationId: conv.id,
    ...(reopenedConversationId ? { reopenedConversationId } : {}),
    message: {
      id: saved.id,
      content,
      createdAt: saved.createdAt.toISOString(),
      direction: "out",
      messageType: "template",
      senderName,
      externalId,
    },
  };
}

/**
 * Efeitos colaterais comuns a um envio humano/integração de texto: encerra
 * salesbot ativo, dispara `message_sent` e cancela agendamentos pendentes.
 * Todos best-effort — nenhum deles deve derrubar um envio bem-sucedido.
 */
async function afterOutboundSideEffects(
  conv: Pick<ConversationLite, "id" | "contactId">,
  actorId: string,
  content: string,
  stopAutomations: boolean,
): Promise<void> {
  if (stopAutomations && conv.contactId) {
    try {
      await cancelActiveContextsForContact(conv.contactId);
    } catch (err) {
      console.warn("[automation] cancel after outbound:", err);
    }
  }
  fireTrigger("message_sent", {
    contactId: conv.contactId,
    data: { channel: "WhatsApp", content },
  }).catch((err) => console.warn("[automation trigger] message_sent:", err));
  cancelPendingForConversation(conv.id, "agent_reply", actorId).catch((err) =>
    console.warn("[scheduled-messages] falha ao cancelar apos envio:", err),
  );
}
