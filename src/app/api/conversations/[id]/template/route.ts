import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requireConversationAccess } from "@/lib/conversation-access";
import { metaWhatsApp } from "@/lib/meta-whatsapp/client";
import { buildOutboundTemplateMessageContent } from "@/lib/whatsapp-outbound-template-label";
import { prisma } from "@/lib/prisma";
import { cancelPendingForConversation } from "@/services/scheduled-messages";

import type { InboxMessageDto } from "../messages/route";

type RouteContext = { params: Promise<{ id: string }> };

type TemplateBody = {
  templateName?: unknown;
  languageCode?: unknown;
  components?: unknown;
  bodyPreview?: unknown;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

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

    const bodyPreview =
      typeof b.bodyPreview === "string" && b.bodyPreview.trim().length > 0
        ? b.bodyPreview.trim()
        : null;

    const conv = await prisma.conversation.findUnique({
      where: { id },
      include: {
        contact: { select: { phone: true, whatsappBsuid: true } },
        channelRef: { select: { provider: true } },
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

    if (!metaWhatsApp.configured) {
      return NextResponse.json(
        {
          message:
            "Meta WhatsApp API não configurada. Defina META_WHATSAPP_ACCESS_TOKEN e META_WHATSAPP_PHONE_NUMBER_ID.",
        },
        { status: 503 }
      );
    }

    const senderName = session.user.name ?? session.user.email ?? "Agente";

    let templateCategory: string | null = null;
    try {
      const cfg = await prisma.whatsAppTemplateConfig.findFirst({
        where: { metaTemplateName: templateName },
        select: { category: true },
      });
      templateCategory = cfg?.category ?? null;
    } catch {}
    if (!templateCategory) {
      const metaTemplates = await metaWhatsApp.listMessageTemplates({ limit: 200 }).catch(() => null) as { data?: { name: string; category?: string }[] } | null;
      const match = metaTemplates?.data?.find((t) => t.name === templateName);
      if (match?.category) templateCategory = match.category;
    }

    const content = buildOutboundTemplateMessageContent(templateName, "generic", templateCategory, bodyPreview);

    let externalId: string | null = null;
    try {
      const result = await metaWhatsApp.sendTemplate(
        to,
        templateName,
        languageCode,
        components,
        recipient
      );
      externalId = result.messages?.[0]?.id ?? null;
    } catch (e: unknown) {
      console.error("[meta-send-template]", e);
      const msg =
        e instanceof Error ? e.message : "Falha ao enviar template pelo WhatsApp.";
      return NextResponse.json({ message: msg }, { status: 502 });
    }

    const saved = await prisma.message.create({
      data: {
        conversationId: conv.id,
        content,
        direction: "out",
        messageType: "template",
        senderName,
        ...(externalId ? { externalId } : {}),
      },
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

    return NextResponse.json({ message: dto }, { status: 201 });
  } catch (e: unknown) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "Erro ao enviar template.";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}
