/**
 * Visibilidade de conversas — Permissions v2 (Sprint 4).
 *
 * Substitui `visibility.conversationWhere` + tabs via `canSeeInboxTab`
 * quando `permissions_v2_enabled` está ativo.
 *
 * ADR-S4-3: channelGrants filtra por channel.type como critério primário.
 *   Formato "<tipo>:<channelId>" específico é suportado adicionalmente
 *   como filtro por channelId quando o ":" está presente.
 */
import type { Prisma } from "@prisma/client";

import { resolveChannelGrants } from "./resolve-permissions";
import { resolveGroupMemberIds } from "./deal-scope";

/**
 * Constrói o filtro de canal a partir dos channelGrants do usuário.
 *
 * Formato dos grants:
 *   "whatsapp"            → todos os canais WhatsApp (filtra por channel string)
 *   "whatsapp:ch_abc123"  → canal específico (filtra por channelId)
 *   []                    → sem restrição
 */
function buildChannelFilter(channelGrants: string[]): Prisma.ConversationWhereInput {
  if (channelGrants.length === 0) return {};

  const typeOnly: string[] = [];
  const specificIds: string[] = [];

  for (const g of channelGrants) {
    const colonIdx = g.indexOf(":");
    if (colonIdx > 0) {
      specificIds.push(g.slice(colonIdx + 1));
    } else {
      typeOnly.push(g);
    }
  }

  const conditions: Prisma.ConversationWhereInput[] = [];
  if (typeOnly.length > 0) {
    conditions.push({ channel: { in: typeOnly } });
  }
  if (specificIds.length > 0) {
    conditions.push({ channelId: { in: specificIds } });
  }

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { OR: conditions };
}

/**
 * Constrói o `Prisma.ConversationWhereInput` de visibilidade para um usuário.
 *
 * Hierarquia (não-exclusiva — condições se acumulam via OR):
 *   conversation:view_all        → sem restrição de assignee
 *   conversation:view_group      → conversas do grupo
 *   conversation:view_own        → só atribuídas ao próprio agente
 *   conversation:view_unassigned → adiciona conversas sem responsável
 *
 * channelGrants (UserGroup.channelGrants):
 *   Filtro ortogonal — [] = todos os canais visíveis.
 *
 * Retorna null quando nenhuma permissão de visibilidade satisfeita.
 */
export async function buildConversationWhere(
  userId: string,
  organizationId: string,
  permissions: Set<string> | string[],
): Promise<Prisma.ConversationWhereInput | null> {
  const perms = permissions instanceof Set ? permissions : new Set(permissions);

  const channelGrants = await resolveChannelGrants(userId);
  const channelFilter = buildChannelFilter(channelGrants);

  const base: Prisma.ConversationWhereInput = {
    organizationId,
    ...channelFilter,
  };

  if (perms.has("*") || perms.has("conversation:view_all")) {
    return base;
  }

  const conditions: Prisma.ConversationWhereInput[] = [];

  if (perms.has("conversation:view_group")) {
    const groupMemberIds = await resolveGroupMemberIds(userId, organizationId);
    if (groupMemberIds.length > 0) {
      conditions.push({ assignedToId: { in: groupMemberIds } });
    }
  }

  if (perms.has("conversation:view_own")) {
    conditions.push({ assignedToId: userId });
  }

  if (perms.has("conversation:view_unassigned")) {
    conditions.push({ assignedToId: null });
  }

  if (conditions.length === 0) return null;

  return { ...base, OR: conditions };
}
