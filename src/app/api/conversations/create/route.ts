import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { MetaWhatsAppClient } from "@/lib/meta-whatsapp/client";
import { enqueueBaileysOutbound } from "@/lib/queue";
import {
  getChannelById,
  parseChannelConfigDecrypted,
} from "@/services/channels";

function str(cfg: Record<string, unknown>, key: string): string | undefined {
  const v = cfg[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

// Bug 27/abr/26: usavamos `auth()` direto. A rota chama `withOrgFromCtx`
// (direto ou via service), avaliado ANTES da Prisma extension popular
// o ctx. Migrado para withOrgContext.
export async function POST(request: Request) {
  return withOrgContext(async (session) => {
    try {
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
      }

      const contactId = typeof body.contactId === "string" ? body.contactId : "";
      const channelId = typeof body.channelId === "string" ? body.channelId : "";
      const message = typeof body.message === "string" ? body.message.trim() : "";
      const skipSend = body.skipSend === true;

      if (!contactId) {
        return NextResponse.json({ message: "contactId obrigatório." }, { status: 400 });
      }

      const contact = await prisma.contact.findUnique({ where: { id: contactId } });
      if (!contact) {
        return NextResponse.json({ message: "Contato não encontrado." }, { status: 404 });
      }

      // If skipSend, create/reuse conversation record without sending a message.
      // Used when opening chat for a contact with no prior conversations.
      if (skipSend) {
        const existing = await prisma.conversation.findFirst({
          where: { contactId: contact.id, channel: "whatsapp" },
          select: {
            id: true, externalId: true, channel: true,
            status: true, inboxName: true, createdAt: true, updatedAt: true,
          },
        });

        let channelName: string | null = null;
        if (channelId) {
          const ch = await getChannelById(channelId);
          channelName = ch?.name ?? null;
        }
        if (!channelName) {
          const firstChannel = await prisma.channel.findFirst({
            where: { type: "WHATSAPP", status: "CONNECTED" },
            select: { name: true },
          });
          channelName = firstChannel?.name ?? null;
        }

        let conversation;
        if (existing) {
          conversation = existing;
        } else {
          conversation = await prisma.conversation.create({
            data: withOrgFromCtx({
              channel: "whatsapp",
              status: "OPEN" as const,
              inboxName: channelName,
              contactId: contact.id,
              ...(contact.assignedToId ? { assignedToId: contact.assignedToId } : {}),
            }),
            select: {
              id: true, externalId: true, channel: true,
              status: true, inboxName: true, createdAt: true, updatedAt: true,
            },
          });
        }

        return NextResponse.json({
          conversation: {
            id: conversation.id,
            externalId: conversation.externalId,
            channel: conversation.channel,
            status: conversation.status,
            inboxName: conversation.inboxName ?? channelName,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
          },
        }, { status: existing ? 200 : 201 });
      }

      if (!channelId) {
        return NextResponse.json({ message: "channelId obrigatório." }, { status: 400 });
      }
      if (!message) {
        return NextResponse.json({ message: "Mensagem obrigatória." }, { status: 400 });
      }

      const channel = await getChannelById(channelId);
      if (!channel) {
        return NextResponse.json({ message: "Canal não encontrado." }, { status: 404 });
      }

      if (channel.status !== "CONNECTED") {
        return NextResponse.json(
          { message: `Canal "${channel.name}" não está conectado (status: ${channel.status}).` },
          { status: 400 }
        );
      }

      const waDigits = contact.phone?.replace(/\D/g, "") ?? "";
      const waTo = waDigits.length >= 8 ? waDigits : undefined;
      const waRecipient = contact.whatsappBsuid?.trim() || undefined;
      if (!waTo && !waRecipient) {
        return NextResponse.json(
          {
            message:
              "Contato sem telefone nem BSUID WhatsApp.",
          },
          { status: 400 }
        );
      }

      const existing = await prisma.conversation.findFirst({
        where: { contactId: contact.id, channel: "whatsapp" },
        select: { id: true, externalId: true, waJid: true },
      });

      let conversation;
      if (existing) {
        conversation = await prisma.conversation.update({
          where: { id: existing.id },
          data: { status: "OPEN", inboxName: channel.name, channelId: channel.id, updatedAt: new Date() },
        });
      } else {
        conversation = await prisma.conversation.create({
          data: withOrgFromCtx({
            channel: "whatsapp",
            status: "OPEN" as const,
            inboxName: channel.name,
            channelId: channel.id,
            contactId: contact.id,
            ...(contact.assignedToId ? { assignedToId: contact.assignedToId } : {}),
          }),
        });
      }

      const senderName = session.user.name ?? session.user.email ?? "Agente";

      if (channel.provider === "BAILEYS_MD") {
        const msgRow = await prisma.message.create({
          data: withOrgFromCtx({
            conversationId: conversation.id,
            content: message,
            direction: "out",
            messageType: "text",
            senderName,
          }),
        });

        const baileysTo = existing?.waJid ?? contact.phone!;
        await enqueueBaileysOutbound({
          channelId: channel.id,
          to: baileysTo,
          content: message,
          messageType: "text",
          conversationId: conversation.id,
          messageId: msgRow.id,
        });
      } else {
        const config = parseChannelConfigDecrypted({
          provider: channel.provider,
          config: channel.config,
        });
        const accessToken = str(config, "accessToken");
        const phoneNumberId = str(config, "phoneNumberId") ?? channel.phoneNumber ?? undefined;
        const businessAccountId = str(config, "businessAccountId");

        if (!accessToken || !phoneNumberId || !businessAccountId) {
          return NextResponse.json(
            { message: "Config Meta incompleta (accessToken, phoneNumberId, businessAccountId)." },
            { status: 400 }
          );
        }

        const meta = new MetaWhatsAppClient(accessToken, phoneNumberId, businessAccountId);
        await meta.sendMessage(waTo, message, waRecipient);

        await prisma.message.create({
          data: withOrgFromCtx({
            conversationId: conversation.id,
            content: message,
            direction: "out",
            messageType: "text",
            senderName,
          }),
        });
      }

      return NextResponse.json({
        conversation: {
          id: conversation.id,
          externalId: conversation.externalId,
          channel: "whatsapp",
          status: "OPEN",
          inboxName: channel.name,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        },
      }, { status: 201 });
    } catch (e: unknown) {
      console.error("Error creating conversation:", e);
      const msg = e instanceof Error ? e.message : "Erro ao criar conversa.";
      return NextResponse.json({ message: msg }, { status: 500 });
    }
  });
}
