import type {
  ChannelProvider,
  ChannelType,
  Prisma,
} from "@prisma/client";
import { NextResponse } from "next/server";

import { requireChannelScope } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";

/**
 * Forma "lite" do canal — o mesmo shape que `getConversationLite` devolve via
 * `channelRef`. Mantém compat com `sendWhatsAppText` / `sendWhatsAppMedia`,
 * que só precisam de `{ id, provider, config }` para escolher Baileys/Meta.
 *
 * Tipos `ChannelType` / `ChannelProvider` vêm do Prisma para que esta forma
 * seja substituível com `conv.channelRef` (mesma origem) sem cast.
 */
export type LiteChannelRef = {
  id: string;
  provider: ChannelProvider;
  config: Prisma.JsonValue;
  name: string;
  phoneNumber: string | null;
  type: ChannelType;
} | null;

/**
 * Resolve o canal pelo qual a mensagem outbound será de fato enviada.
 *
 * Hoje (pré-fix) os endpoints de envio usavam SEMPRE `conv.channelId` /
 * `conv.channelRef`. Orgs com múltiplos WhatsApps perdiam a capacidade de
 * escolher por qual número falar — o canal "ficava" travado no último
 * inbound. Este helper aceita um `requestedChannelId` opcional vindo do
 * client (composer do Inbox / Deal). Quando presente, valida:
 *
 *   - canal existe e pertence à mesma org do user
 *   - tipo é WHATSAPP (manda mensagens por outros canais é fora de escopo)
 *   - status CONNECTED (não deixa enviar por canal off, evita pending eterno)
 *   - user tem `channel.send` no canal escolhido (scope-grants granulares)
 *
 * Se `requestedChannelId` for ausente ou igual ao `conv.channelId`,
 * devolve `conv.channelRef` direto (caminho rápido, zero round-trip extra).
 *
 * IMPORTANTE: este helper NÃO atualiza `conversation.channelId`. O canal
 * "atual" da conversa segue sendo determinado pelo último inbound — só a
 * mensagem em si guarda o canal de envio em `message.channelId` (snapshot).
 */
export async function resolveOutboundChannel(args: {
  conv: {
    channelId: string | null;
    channelRef: LiteChannelRef;
    organizationId: string;
  };
  user: {
    id: string;
    role?: string | null;
    organizationId: string | null;
    isSuperAdmin?: boolean;
  };
  requestedChannelId: string | null | undefined;
}): Promise<
  | { ok: true; channelRef: LiteChannelRef; channelId: string | null }
  | { ok: false; response: NextResponse }
> {
  const requested = args.requestedChannelId?.trim() || null;

  if (!requested || requested === args.conv.channelId) {
    return {
      ok: true,
      channelRef: args.conv.channelRef,
      channelId: args.conv.channelId,
    };
  }

  const channel = await prisma.channel.findUnique({
    where: { id: requested },
    select: {
      id: true,
      organizationId: true,
      type: true,
      status: true,
      provider: true,
      config: true,
      name: true,
      phoneNumber: true,
    },
  });

  if (!channel || channel.organizationId !== args.conv.organizationId) {
    return {
      ok: false,
      response: NextResponse.json(
        { message: "Canal informado não pertence à organização." },
        { status: 400 },
      ),
    };
  }

  if (channel.type !== "WHATSAPP") {
    return {
      ok: false,
      response: NextResponse.json(
        { message: "Override de canal só é suportado para WhatsApp." },
        { status: 400 },
      ),
    };
  }

  if (channel.status !== "CONNECTED") {
    return {
      ok: false,
      response: NextResponse.json(
        { message: `Canal "${channel.name}" não está conectado.` },
        { status: 409 },
      ),
    };
  }

  const sendDenied = await requireChannelScope(args.user, "send", channel.id);
  if (sendDenied) {
    return { ok: false, response: sendDenied };
  }

  return {
    ok: true,
    channelRef: {
      id: channel.id,
      provider: channel.provider,
      config: channel.config as Prisma.JsonValue,
      name: channel.name,
      phoneNumber: channel.phoneNumber,
      type: channel.type,
    },
    channelId: channel.id,
  };
}
