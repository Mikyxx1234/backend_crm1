/**
 * Garantia de Conversation WhatsApp associada a um Contact, com `channelId`
 * já vinculado ao canal Meta Cloud API padrão da organização.
 *
 * Uso intencional: envio/abertura explícita de chat e automações que precisam
 * de conversa antes de mandar mensagem. **Não** chamar ao só criar
 * contato/deal/lead — isso abria ticket no inbox como se o lead tivesse
 * escrito.
 *
 * Idempotente:
 *  - Se já existe Conversation WA ativa pro contato e ela tem `channelId`, no-op.
 *  - Se existe mas está sem `channelId`, faz UPDATE com o default.
 *  - Se não existe, cria com `channelId` do default.
 *  - Se a org não tem canal Meta CONNECTED, retorna skipped (nada quebra).
 */

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { logEvent } from "@/services/activity-log";
import {
  isActiveConversationUniqueViolation,
  withConversationNumberRetry,
} from "@/services/conversations";
import { fireTrigger } from "@/services/automation-triggers";
import { getLogger } from "@/lib/logger";

const log = getLogger("whatsapp-conversation");

export type DefaultWhatsAppChannel = {
  id: string;
  name: string;
};

/**
 * Resolve o canal WhatsApp Meta Cloud API "padrão" da organização corrente.
 *
 * Heurística: primeiro canal `WHATSAPP` + `META_CLOUD_API` + `CONNECTED`
 * por `createdAt asc`. Mesma regra que o `automation-executor` já usa pra
 * envios sem canal explícito — mantendo comportamento consistente.
 *
 * Não considera Baileys (QR): templates não são suportados nesse provider,
 * então não faz sentido "reservar" a conversa nele.
 *
 * @returns `{ id, name }` do canal ou `null` se a org não tem nenhum
 *   canal Meta CONNECTED.
 */
export async function resolveDefaultWhatsAppChannel(): Promise<DefaultWhatsAppChannel | null> {
  const ch = await prisma.channel.findFirst({
    where: {
      type: "WHATSAPP",
      provider: "META_CLOUD_API",
      status: "CONNECTED",
    },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  return ch ? { id: ch.id, name: ch.name } : null;
}

export type EnsureConversationResult =
  | { status: "created"; conversationId: string; channelId: string }
  | { status: "backfilled_channel"; conversationId: string; channelId: string }
  | { status: "already_ok"; conversationId: string; channelId: string | null }
  | { status: "skipped_no_channel" }
  | { status: "skipped_contact_missing" }
  | { status: "skipped_no_phone" };

/**
 * Garante que exista uma Conversation WhatsApp pro contato, com `channelId`
 * preenchido. Ver docstring do módulo pros cenários idempotentes.
 *
 * @param contactId ID do Contact — o caller deve garantir que pertence à org
 *   corrente (o RequestContext ativo cuida do resto via prisma extension).
 */
export async function ensureWhatsAppConversationForContact(
  contactId: string,
): Promise<EnsureConversationResult> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      name: true,
      phone: true,
      whatsappBsuid: true,
      assignedToId: true,
    },
  });
  if (!contact) return { status: "skipped_contact_missing" };

  // Sem canal de destino não faz sentido "reservar" conversa por telefone.
  // Mantemos flexibilidade: BSUID (Meta) sozinho também qualifica.
  const hasReachableIdentity =
    Boolean(contact.phone?.trim()) || Boolean(contact.whatsappBsuid?.trim());
  if (!hasReachableIdentity) return { status: "skipped_no_phone" };

  const defaultChannel = await resolveDefaultWhatsAppChannel();
  if (!defaultChannel) return { status: "skipped_no_channel" };

  // Modelo de ticket: reusa apenas conversa nao-RESOLVED. Quando a ultima
  // esta encerrada, o proximo envio gera nova conversa com #N+1 — mantendo
  // as mensagens antigas encapsuladas no ticket anterior. Decisao aprovada
  // pelo operador (ver AGENT.md "ID de conversa + logs + gatilho" e
  // pergunta "estrategia = ticket puro").
  const existing = await prisma.conversation.findFirst({
    where: {
      contactId: contact.id,
      channel: "whatsapp",
      status: { not: "RESOLVED" },
    },
    select: { id: true, channelId: true, inboxName: true },
  });

  if (existing) {
    if (existing.channelId === defaultChannel.id) {
      return {
        status: "already_ok",
        conversationId: existing.id,
        channelId: existing.channelId,
      };
    }
    if (!existing.channelId) {
      // Backfill: conversa existe mas ficou órfã (criada via `skipSend` legado
      // ou por seed). Só atualiza quando o campo está NULL — se aponta pra
      // outro canal, respeita a escolha explícita anterior.
      const updateData: Prisma.ConversationUpdateInput = {
        channelId: defaultChannel.id,
        inboxName: existing.inboxName ?? defaultChannel.name,
      };
      await prisma.conversation.update({
        where: { id: existing.id },
        data: updateData,
      });
      return {
        status: "backfilled_channel",
        conversationId: existing.id,
        channelId: defaultChannel.id,
      };
    }
    return {
      status: "already_ok",
      conversationId: existing.id,
      channelId: existing.channelId,
    };
  }

  let created: { id: string; channelId: string | null };
  try {
    created = await withConversationNumberRetry((number) =>
      prisma.conversation.create({
        data: withOrgFromCtx({
          number,
          channel: "whatsapp",
          status: "OPEN" as const,
          inboxName: defaultChannel.name,
          channelId: defaultChannel.id,
          contactId: contact.id,
          ...(contact.assignedToId ? { assignedToId: contact.assignedToId } : {}),
        }),
        select: { id: true, channelId: true },
      }),
    );
  } catch (err) {
    // Corrida com inbound/outro caller: reusa o ticket ativo vencedor
    // (indice unico parcial). Ver `isActiveConversationUniqueViolation`.
    if (isActiveConversationUniqueViolation(err)) {
      const won = await prisma.conversation.findFirst({
        where: { contactId: contact.id, channel: "whatsapp", status: { not: "RESOLVED" } },
        select: { id: true, channelId: true },
      });
      if (won) {
        return {
          status: "already_ok",
          conversationId: won.id,
          channelId: won.channelId,
        };
      }
    }
    throw err;
  }

  void logEvent({
    type: "CONVERSATION_CREATED",
    entityType: "CONVERSATION",
    entityId: created.id,
    entityLabel: contact.name ?? contact.phone ?? null,
    conversationId: created.id,
    contactId: contact.id,
    meta: {
      channel: "whatsapp",
      inboxName: defaultChannel.name,
      source: "auto_ensure",
    },
  });

  // Gatilho de automacao (fire-and-forget). O tipo `conversation_created`
  // ja existe registrado; ate hoje o fireTrigger nao era chamado — so o
  // logEvent. Ver AGENT.md "ID de conversa + logs + gatilho".
  fireTrigger("conversation_created", {
    contactId: contact.id,
    data: { channel: "whatsapp", inboxName: defaultChannel.name, source: "auto_ensure" },
  }).catch((err) => log.warn("Falha no gatilho conversation_created:", err));

  return {
    status: "created",
    conversationId: created.id,
    channelId: created.channelId ?? defaultChannel.id,
  };
}
