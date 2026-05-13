import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getCallPermissionTemplateName } from "@/lib/call-permission-env";
import { buildOutboundTemplateMessageContent } from "@/lib/whatsapp-outbound-template-label";
import { requireConversationAccess } from "@/lib/conversation-access";
import { metaWhatsApp } from "@/lib/meta-whatsapp/client";
import { prisma } from "@/lib/prisma";
import { sseBus } from "@/lib/sse-bus";
import { extractTemplateComponents } from "@/lib/whatsapp-template-components";

import { WhatsappCallConsentStatus } from "@prisma/client";

import type { InboxMessageDto } from "../messages/route";

/**
 * Busca componentes do template pela Meta (para construir o log do chat com
 * a cópia real, incluindo os botões). Resiliente: se qualquer passo falhar,
 * devolve `null` e o endpoint cai no texto genérico.
 */
async function fetchTemplatePreviewFromMeta(
  templateName: string,
  languageCode: string,
): Promise<{ bodyText: string; headerText: string; footerText: string; buttons: string[] } | null> {
  try {
    const raw = (await metaWhatsApp.listMessageTemplates({ limit: 200 })) as {
      data?: Array<{
        name?: string;
        language?: string;
        components?: unknown[];
      }>;
    };
    const rows = Array.isArray(raw.data) ? raw.data : [];
    // Match exato por nome + idioma; se não bater idioma, aceita primeiro do nome.
    const match =
      rows.find(
        (r) =>
          (r.name ?? "").trim() === templateName &&
          (r.language ?? "").trim().toLowerCase() === languageCode.toLowerCase(),
      ) ?? rows.find((r) => (r.name ?? "").trim() === templateName);
    if (!match) return null;
    return extractTemplateComponents(match.components);
  } catch (e) {
    console.warn(
      "[call-permission] falha ao buscar preview do template:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

type RouteContext = { params: Promise<{ id: string }> };

const VALID_PATCH = new Set<string>(Object.values(WhatsappCallConsentStatus));

/**
 * POST: envia template de opt-in de chamada e marca REQUESTED.
 * Nome do template: corpo `templateName` ou env META_WHATSAPP_CALL_PERMISSION_TEMPLATE.
 * PATCH: ADMIN/MANAGER — ajuste manual do consentimento até o webhook de botões estar 100% alinhado.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { id } = await context.params;
    const denied = await requireConversationAccess(session, id);
    if (denied) return denied;

    let languageCode = "pt_BR";
    let bodyFromRequest: Record<string, unknown> = {};
    try {
      bodyFromRequest = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    } catch {
      bodyFromRequest = {};
    }
    const b = bodyFromRequest;
    if (typeof b.languageCode === "string" && b.languageCode.trim()) {
      languageCode = b.languageCode.trim();
    }
    const fromBody =
      typeof b.templateName === "string" ? b.templateName.trim() : "";
    const templateName = fromBody || getCallPermissionTemplateName() || "";
    if (!templateName) {
      return NextResponse.json(
        {
          message:
            "Informe o nome do template no corpo (templateName) ou defina META_WHATSAPP_CALL_PERMISSION_TEMPLATE no servidor.",
        },
        { status: 400 }
      );
    }

    const conv = await prisma.conversation.findUnique({
      where: { id },
      include: { contact: { select: { phone: true, whatsappBsuid: true } } },
    });

    if (!conv) {
      return NextResponse.json({ message: "Conversa não encontrada." }, { status: 404 });
    }
    if (conv.channel !== "whatsapp") {
      return NextResponse.json(
        { message: "Opt-in de chamada só se aplica a conversas WhatsApp." },
        { status: 400 }
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

    // Busca cópia real do template (corpo + botões) pra log fiel no chat.
    const preview = await fetchTemplatePreviewFromMeta(templateName, languageCode);
    const content = buildOutboundTemplateMessageContent(
      templateName,
      "call_permission",
      null,
      preview?.bodyText ?? null,
      preview
        ? {
            bodyText: preview.bodyText,
            headerText: preview.headerText,
            footerText: preview.footerText,
            buttons: preview.buttons,
          }
        : undefined,
    );

    let externalId: string | null = null;
    try {
      const result = await metaWhatsApp.sendTemplate(
        to,
        templateName,
        languageCode,
        undefined,
        recipient
      );
      externalId = result.messages?.[0]?.id ?? null;
    } catch (e: unknown) {
      console.error("[call-permission-template]", e);
      const msg =
        e instanceof Error ? e.message : "Falha ao enviar template pelo WhatsApp.";
      return NextResponse.json({ message: msg }, { status: 502 });
    }

    const now = new Date();
    const [savedMsg] = await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: conv.id,
          content,
          direction: "out",
          messageType: "template",
          senderName,
          ...(externalId ? { externalId } : {}),
        },
      }),
      prisma.conversation.update({
        where: { id: conv.id },
        data: {
          whatsappCallConsentStatus: "REQUESTED",
          whatsappCallConsentUpdatedAt: now,
          updatedAt: now,
        },
      }),
    ]);

    // Novo pedido = reseta qualquer tipo/expiração anterior para evitar
    // inconsistência (cliente respondeu antes e voltamos pra REQUESTED).
    // Raw SQL porque as colunas são novas e o Prisma Client local pode estar dessincronizado.
    try {
      await prisma.$executeRaw`
        UPDATE "conversations"
        SET
          "whatsappCallConsentType" = NULL,
          "whatsappCallConsentExpiresAt" = NULL
        WHERE "id" = ${conv.id}
      `;
    } catch (err) {
      console.warn(
        "[call-permission] não resetou type/expiresAt (migration pendente?):",
        err instanceof Error ? err.message : err,
      );
    }

    const dto: InboxMessageDto = {
      id: externalId ?? savedMsg.id,
      content,
      createdAt: savedMsg.createdAt.toISOString(),
      direction: "out",
      messageType: "template",
      senderName,
    };

    return NextResponse.json({ message: dto, consentStatus: "REQUESTED" as const }, { status: 201 });
  } catch (e: unknown) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "Erro ao solicitar permissão de chamada.";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const user = session.user as { id: string; role: "ADMIN" | "MANAGER" | "MEMBER" };
    if (user.role !== "ADMIN" && user.role !== "MANAGER") {
      return NextResponse.json({ message: "Sem permissão." }, { status: 403 });
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
    const b = body as { status?: unknown };
    const raw = typeof b.status === "string" ? b.status.trim().toUpperCase() : "";
    const status =
      raw && VALID_PATCH.has(raw) ? (raw as WhatsappCallConsentStatus) : null;
    if (!status) {
      return NextResponse.json(
        { message: "Informe status: NONE, REQUESTED, GRANTED ou EXPIRED." },
        { status: 400 }
      );
    }

    const conv = await prisma.conversation.findUnique({
      where: { id },
      select: { id: true, channel: true, contactId: true },
    });
    if (!conv) {
      return NextResponse.json({ message: "Conversa não encontrada." }, { status: 404 });
    }
    if (conv.channel !== "whatsapp") {
      return NextResponse.json({ message: "Apenas conversas WhatsApp." }, { status: 400 });
    }

    const now = new Date();
    await prisma.conversation.update({
      where: { id },
      data: {
        whatsappCallConsentStatus: status,
        whatsappCallConsentUpdatedAt: now,
        updatedAt: now,
      },
    });

    sseBus.publish("conversation_updated", {
      conversationId: conv.id,
      contactId: conv.contactId,
      whatsappCallConsentStatus: status,
    });

    return NextResponse.json({ consentStatus: status });
  } catch (e: unknown) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao atualizar consentimento." }, { status: 500 });
  }
}
