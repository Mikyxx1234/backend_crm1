import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { getCallPermissionTemplateName } from "@/lib/call-permission-env";
import { buildOutboundTemplateMessageContent } from "@/lib/whatsapp-outbound-template-label";
import { requireConversationAccess } from "@/lib/conversation-access";
import { metaClientFromConfig } from "@/lib/meta-whatsapp/client";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { sseBus } from "@/lib/sse-bus";

import { WhatsappCallConsentStatus } from "@prisma/client";

import type { InboxMessageDto } from "../messages/route";

function strField(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Cópia já conhecida pelo inbox — evita relistar `message_templates` no POST. */
function previewFromBody(b: Record<string, unknown>): {
  bodyText: string;
  headerText: string;
  footerText: string;
  buttons: string[];
} | null {
  const bodyText = strField(b.bodyText);
  const headerText = strField(b.headerText);
  const footerText = strField(b.footerText);
  const buttons = Array.isArray(b.buttons)
    ? b.buttons.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
    : [];
  if (!bodyText && !headerText && !footerText && buttons.length === 0) return null;
  return { bodyText, headerText, footerText, buttons };
}

type RouteContext = { params: Promise<{ id: string }> };

const VALID_PATCH = new Set<string>(Object.values(WhatsappCallConsentStatus));

/**
 * POST: envia template de opt-in de chamada e marca REQUESTED.
 * Nome do template: corpo `templateName` ou env META_WHATSAPP_CALL_PERMISSION_TEMPLATE.
 * PATCH: ADMIN/MANAGER — ajuste manual do consentimento até o webhook de botões estar 100% alinhado.
 */
// Bug 27/abr/26: usavamos `auth()` direto. A rota chama `withOrgFromCtx`
// (direto ou via service), avaliado ANTES da Prisma extension popular
// o ctx. Migrado para withOrgContext.
export async function POST(request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    try {
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
        include: {
          contact: { select: { phone: true, whatsappBsuid: true } },
          // Resolver cliente Meta correto pelo canal da conversa (per-tenant).
          channelRef: { select: { id: true, config: true } },
        },
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

      const channelConfig = conv.channelRef?.config as
        | Record<string, unknown>
        | null
        | undefined;
      const metaClient = metaClientFromConfig(channelConfig);

      if (!metaClient.configured) {
        return NextResponse.json(
          {
            message:
              "Canal WhatsApp da conversa sem credenciais Meta (accessToken/phoneNumberId). Configure em Canais.",
          },
          { status: 503 }
        );
      }

      const senderName = session.user.name ?? session.user.email ?? "Agente";

      // Templates CALL_PERMISSIONS_REQUEST não usam WhatsApp Flow. Relistar
      // `message_templates` (preview + enrich) no POST estoura o timeout do
      // EasyPanel e o browser recebe 502 HTML em vez do JSON da API.
      const preview = previewFromBody(b);
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
        const result = await metaClient.sendTemplate(
          to,
          templateName,
          languageCode,
          undefined,
          recipient,
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
          data: withOrgFromCtx({
            conversationId: conv.id,
            content,
            direction: "out",
            messageType: "template",
            senderName,
            ...(externalId ? { externalId } : {}),
          }),
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
      // Defesa em profundidade: conv ja foi carregado scoped pela extension,
      // mas adicionamos AND organizationId aqui pra alinhar com RLS futuro.
      try {
        const orgIdFilter = session.user.organizationId ?? "__no_org__";
        await prisma.$executeRaw`
          UPDATE "conversations"
          SET
            "whatsappCallConsentType" = NULL,
            "whatsappCallConsentExpiresAt" = NULL
          WHERE "id" = ${conv.id}
            AND "organizationId" = ${orgIdFilter}
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
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    try {
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
        select: { id: true, channel: true, contactId: true, organizationId: true },
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
        organizationId: conv.organizationId,
        conversationId: conv.id,
        contactId: conv.contactId,
        whatsappCallConsentStatus: status,
      });

      return NextResponse.json({ consentStatus: status });
    } catch (e: unknown) {
      console.error(e);
      return NextResponse.json({ message: "Erro ao atualizar consentimento." }, { status: 500 });
    }
  });
}
