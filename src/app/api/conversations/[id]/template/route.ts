import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { requireConversationAccess } from "@/lib/conversation-access";
import { metaClientFromConfig } from "@/lib/meta-whatsapp/client";
import { enrichTemplateComponentsForFlowSend } from "@/lib/meta-whatsapp/enrich-template-flow";
import { buildOutboundTemplateMessageContent } from "@/lib/whatsapp-outbound-template-label";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { sseBus } from "@/lib/sse-bus";
import { cancelPendingForConversation } from "@/services/scheduled-messages";

import type { InboxMessageDto } from "../messages/route";

type RouteContext = { params: Promise<{ id: string }> };

type TemplateBody = {
  templateName?: unknown;
  languageCode?: unknown;
  components?: unknown;
  bodyPreview?: unknown;
  /** ID Graph do template (Meta `message_templates.id`) — melhora envio de templates com botão FLOW. */
  templateGraphId?: unknown;
  /** Token Flow (opcional); vazio = o servidor gera UUID v4 por envio e persiste em `Message.flowToken`. */
  flowToken?: unknown;
  /** JSON com dados iniciais do formulário / `navigate` — ver docs WhatsApp Flows. */
  flowActionData?: unknown;
};

// Bug 24/abr/26: usavamos `auth()` direto. O handler depende da Prisma
// extension multi-tenant pra resolver organizationId em queries de
// conversation/whatsAppTemplateConfig/message.create. Sem o
// AsyncLocalStorage scope ativo o envio falhava silenciosamente
// (templates "nao saiam"). withOrgContext envolve em runWithContext.
export async function POST(request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
   try {
    const { id } = await context.params;
    const denied = await requireConversationAccess(session, id);
    if (denied) return denied;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const b = body as TemplateBody;
    const templateName =
      typeof b.templateName === "string" ? b.templateName.trim() : "";
    if (!templateName) {
      return NextResponse.json(
        { message: "templateName é obrigatório." },
        { status: 400 }
      );
    }

    const languageCode =
      typeof b.languageCode === "string" && b.languageCode.trim().length > 0
        ? b.languageCode.trim()
        : "pt_BR";

    const components = Array.isArray(b.components)
      ? (b.components as unknown[])
      : undefined;

    const flowToken =
      typeof b.flowToken === "string" && b.flowToken.trim().length > 0
        ? b.flowToken.trim()
        : null;
    let flowActionData: Record<string, unknown> | null = null;
    if (b.flowActionData && typeof b.flowActionData === "object" && !Array.isArray(b.flowActionData)) {
      flowActionData = b.flowActionData as Record<string, unknown>;
    }

    const templateGraphIdFromBody =
      typeof b.templateGraphId === "string" && b.templateGraphId.trim().length > 0
        ? b.templateGraphId.trim()
        : null;

    const bodyPreview =
      typeof b.bodyPreview === "string" && b.bodyPreview.trim().length > 0
        ? b.bodyPreview.trim()
        : null;

    const conv = await prisma.conversation.findUnique({
      where: { id },
      include: {
        contact: { select: { phone: true, whatsappBsuid: true } },
        // CRITICO: trazer config do canal para resolver o cliente Meta correto
        // por canal/org. Antes usavamos o singleton global metaWhatsApp (env)
        // que rotava TODO mundo pelo numero da primeira org configurada -> leak
        // entre tenants (templates da DNA saiam pelo numero da Eduit).
        channelRef: { select: { id: true, provider: true, config: true } },
      },
    });

    if (!conv) {
      return NextResponse.json({ message: "Conversa não encontrada." }, { status: 404 });
    }

    if (conv.channelRef?.provider === "BAILEYS_MD") {
      return NextResponse.json(
        { message: "Templates não são suportados em canais WhatsApp QR (Baileys). Use mensagem de texto." },
        { status: 400 },
      );
    }

    const digits = conv.contact?.phone?.replace(/\D/g, "") ?? "";
    const to = digits.length >= 8 ? digits : undefined;
    const recipient = conv.contact?.whatsappBsuid?.trim() || undefined;
    if (!to && !recipient) {
      return NextResponse.json(
        { message: "Contato sem telefone nem BSUID WhatsApp (Meta)." },
        { status: 400 }
      );
    }

    const channelConfig = conv.channelRef?.config as Record<string, unknown> | null | undefined;
    const metaClient = metaClientFromConfig(channelConfig);

    if (!metaClient.configured) {
      return NextResponse.json(
        {
          message:
            "Canal WhatsApp da conversa sem credenciais Meta (accessToken/phoneNumberId). Configure em Canais ou defina META_WHATSAPP_* no env.",
        },
        { status: 503 }
      );
    }

    const senderName = session.user.name ?? session.user.email ?? "Agente";

    let templateCategory: string | null = null;
    let templateGraphId: string | null = templateGraphIdFromBody;
    try {
      const cfg = await prisma.whatsAppTemplateConfig.findFirst({
        where: { metaTemplateName: templateName },
        select: { category: true, metaTemplateId: true },
      });
      templateCategory = cfg?.category ?? null;
      if (!templateGraphId && cfg?.metaTemplateId?.trim()) {
        templateGraphId = cfg.metaTemplateId.trim();
      }
    } catch {}
    if (!templateCategory) {
      const metaTemplates = await metaClient.listMessageTemplates({ limit: 200 }).catch(() => null) as { data?: { name: string; category?: string }[] } | null;
      const match = metaTemplates?.data?.find((t) => t.name === templateName);
      if (match?.category) templateCategory = match.category;
    }

    const content = buildOutboundTemplateMessageContent(templateName, "generic", templateCategory, bodyPreview);

    let externalId: string | null = null;
    let resolvedFlowToken: string | null = null;
    try {
      const enrichResult = await enrichTemplateComponentsForFlowSend(metaClient, {
        templateName,
        languageCode,
        components,
        flowToken,
        flowActionData,
        templateGraphId,
      });
      resolvedFlowToken = enrichResult.flowToken;
      const result = await metaClient.sendTemplate(
        to,
        templateName,
        languageCode,
        enrichResult.components,
        recipient
      );
      externalId = result.messages?.[0]?.id ?? null;
      console.log(
        `[meta-send-template] template=${templateName} channel=${conv.channelRef?.id ?? "ENV"} to=${to ?? "—"}/${recipient ?? "—"} wamid=${externalId}`,
      );
    } catch (e: unknown) {
      console.error("[meta-send-template]", e);
      const msg =
        e instanceof Error ? e.message : "Falha ao enviar template pelo WhatsApp.";
      return NextResponse.json({ message: msg }, { status: 502 });
    }

    const saved = await prisma.message.create({
      data: withOrgFromCtx({
        conversationId: conv.id,
        content,
        direction: "out",
        messageType: "template",
        senderName,
        ...(externalId ? { externalId } : {}),
        ...(typeof resolvedFlowToken === "string" && resolvedFlowToken.trim()
          ? { flowToken: resolvedFlowToken.trim() }
          : {}),
      }),
    });

    const dto: InboxMessageDto = {
      id: externalId ?? saved.id,
      content,
      createdAt: saved.createdAt.toISOString(),
      direction: "out",
      messageType: "template",
      senderName,
    };

    // Template manual tambem cancela agendamentos pendentes.
    cancelPendingForConversation(conv.id, "agent_reply", session.user.id as string).catch(
      (err) =>
        console.warn(
          "[scheduled-messages] falha ao cancelar apos envio de template:",
          err,
        ),
    );

    // Tempo real: SSE pra movimentar a conversa entre tabs sem polling.
    try {
      sseBus.publish("new_message", {
        organizationId: conv.organizationId,
        conversationId: conv.id,
        contactId: conv.contactId,
        direction: "out",
        content,
        timestamp: saved.createdAt,
      });
    } catch {
      // best-effort
    }

    return NextResponse.json({ message: dto }, { status: 201 });
   } catch (e: unknown) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "Erro ao enviar template.";
    return NextResponse.json({ message: msg }, { status: 500 });
   }
  });
}
