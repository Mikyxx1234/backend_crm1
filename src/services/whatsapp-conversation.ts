/**
 * Garantia de Conversation WhatsApp associada a um Contact, com `channelId`
 * já vinculado ao canal Meta Cloud API padrão da organização.
 *
 * Motivação: templates e mensagens só sobem se `Conversation.channelId` aponta
 * pra o canal correto — sem isso, o envio cai no `metaClientFromConfig` sem
 * config e usa o env singleton (que hoje traz credenciais da EduIT), quebrando
 * com "Object with ID '...' does not exist or missing permissions" (Meta code
 * 100/33). Esse leak entre tenants é exatamente o que o comentário na rota
 * `POST /api/conversations/[id]/template` já avisa, mas antes disso a
 * Conversation ficava sem `channelId` sempre que o deal nascia solto pelo
 * pipeline (sem inbound WA prévio).
 *
 * Uso: chame após criar contato/deal com telefone. Idempotente:
 *  - Se já existe Conversation WA pro contato e ela tem `channelId`, no-op.
 *  - Se existe mas está sem `channelId`, faz UPDATE com o default.
 *  - Se não existe, cria com `channelId` do default.
 *  - Se a org não tem canal Meta CONNECTED, retorna `null` (nada quebra;
 *    quando o canal for provisionado, próximas chamadas populam).
 */

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { logEvent } from "@/services/activity-log";

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

  // Reuso: 1 conversa WA por contato (mesmo padrão do webhook Meta e Baileys).
  const existing = await prisma.conversation.findFirst({
    where: { contactId: contact.id, channel: "whatsapp" },
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

  const created = await prisma.conversation.create({
    data: withOrgFromCtx({
      channel: "whatsapp",
      status: "OPEN" as const,
      inboxName: defaultChannel.name,
      channelId: defaultChannel.id,
      contactId: contact.id,
      ...(contact.assignedToId ? { assignedToId: contact.assignedToId } : {}),
    }),
    select: { id: true, channelId: true },
  });

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

  return {
    status: "created",
    conversationId: created.id,
    channelId: created.channelId ?? defaultChannel.id,
  };
}
