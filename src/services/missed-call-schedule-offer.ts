import { getContactWhatsAppTargets } from "@/lib/contact-whatsapp-target";
import { metaWhatsApp } from "@/lib/meta-whatsapp/client";
import { prisma } from "@/lib/prisma";
import { sseBus } from "@/lib/sse-bus";
import { buildOutboundTemplateMessageContent } from "@/lib/whatsapp-outbound-template-label";
import { fireTrigger } from "@/services/automation-triggers";

function templateName(): string | null {
  const n = process.env.META_WHATSAPP_CALL_SCHEDULE_TEMPLATE_NAME?.trim();
  return n || null;
}

function templateLang(): string {
  return process.env.META_WHATSAPP_CALL_SCHEDULE_TEMPLATE_LANG?.trim() || "pt_BR";
}

function templateComponents(): unknown[] | undefined {
  const raw = process.env.META_WHATSAPP_CALL_SCHEDULE_TEMPLATE_COMPONENTS_JSON?.trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Após chamada de entrada perdida (sem `connect`), envia template Meta para o contacto
 * agendar / combinar retorno — se `META_WHATSAPP_CALL_SCHEDULE_TEMPLATE_NAME` estiver definido.
 */
export async function maybeSendMissedCallScheduleTemplate(params: {
  conversationId: string;
  contactId: string;
  callId: string;
}): Promise<void> {
  const name = templateName();
  if (!name) return;

  if (!metaWhatsApp.configured) {
    console.warn("[missed-call-schedule] Meta API não configurada — template não enviado.");
    return;
  }

  const extId = `call_schedule_tpl:${params.callId}`;
  const dup = await prisma.message.findFirst({
    where: { conversationId: params.conversationId, externalId: extId },
    select: { id: true },
  });
  if (dup) return;

  const waTarget = await getContactWhatsAppTargets(params.contactId);
  if (!waTarget?.to && !waTarget?.recipient) {
    console.warn("[missed-call-schedule] Contacto sem telefone/BSUID — template não enviado.");
    return;
  }

  const lang = templateLang();
  const components = templateComponents();

  try {
    await metaWhatsApp.sendTemplate(
      waTarget.to,
      name,
      lang,
      components,
      waTarget.recipient
    );
  } catch (e) {
    console.error("[missed-call-schedule] Falha ao enviar template:", e);
    return;
  }

  const content = buildOutboundTemplateMessageContent(name, "generic");
  await prisma.message.create({
    data: {
      conversationId: params.conversationId,
      content,
      direction: "out",
      messageType: "template",
      senderName: "Sistema",
      externalId: extId,
    },
  });

  await prisma.conversation
    .update({
      where: { id: params.conversationId },
      data: {
        lastMessageDirection: "out",
        updatedAt: new Date(),
      },
    })
    .catch(() => {});

  fireTrigger("message_sent", {
    contactId: params.contactId,
    data: { channel: "WhatsApp", templateScheduleOffer: true },
  }).catch(() => {});

  sseBus.publish("new_message", {
    conversationId: params.conversationId,
    contactId: params.contactId,
    direction: "out",
    content,
    timestamp: new Date(),
  });
}
