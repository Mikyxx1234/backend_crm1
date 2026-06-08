/**
 * Visibilidade de deals — Permissions v2 (Sprint 4).
 *
 * Substitui `getVisibilityFilter()` + `requireStageScope()` +
 * `requirePipelineScope()` quando `permissions_v2_enabled` está ativo.
 *
 * ADR-S4-1: retorna `null` quando nenhuma permissão satisfeita.
 *   O controller chama `denyAccess()` — evita query desnecessária ao banco.
 *
 * ADR-S4-2: `stageGrants` é filtro ortogonal à amplitude (view_all/own/group).
 *   view_all + stageGrants=[leadId] → todos os deals, mas só na fase Lead.
 */
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { resolveStageGrants } from "./resolve-permissions";

/**
 * Resolve IDs de todos os membros dos grupos do usuário.
 * Inclui o próprio userId para garantir que "view_group" cubra os próprios deals.
 * Reutilizado em conversation-scope.ts.
 */
export async function resolveGroupMemberIds(
  userId: string,
  organizationId: string,
): Promise<string[]> {
  const memberships = await prisma.userGroupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  const groupIds = memberships.map((m) => m.groupId);
  if (groupIds.length === 0) return [userId];

  const members = await prisma.userGroupMember.findMany({
    where: { groupId: { in: groupIds }, group: { organizationId } },
    select: { userId: true },
  });
  // Garante que o próprio userId está na lista mesmo se não for membro de nenhum grupo
  const ids = new Set(members.map((m) => m.userId));
  ids.add(userId);
  return Array.from(ids);
}

/**
 * Constrói o `Prisma.DealWhereInput` de visibilidade para um usuário.
 *
 * Hierarquia (primeira condição satisfeita vence):
 *   deal:view_all   → sem restrição de owner
 *   deal:view_group → deals dos membros do mesmo grupo
 *   deal:view_own   → só deals onde é owner
 *   (nenhuma)       → retorna null (controller deve chamar denyAccess())
 *
 * stageGrants (UserGroup.stageGrants):
 *   Aplicado como filtro adicional — ortogonal à amplitude de visibilidade.
 *   [] = todas as fases visíveis.
 */
export async function buildDealWhere(
  userId: string,
  organizationId: string,
  permissions: Set<string> | string[],
  opts?: { extraWhere?: Prisma.DealWhereInput },
): Promise<Prisma.DealWhereInput | null> {
  const perms = permissions instanceof Set ? permissions : new Set(permissions);

  const stageGrants = await resolveStageGrants(userId);
  const stageFilter: Prisma.DealWhereInput =
    stageGrants.length > 0 ? { stageId: { in: stageGrants } } : {};

  const base: Prisma.DealWhereInput = {
    organizationId,
    ...stageFilter,
    ...(opts?.extraWhere ?? {}),
  };

  if (perms.has("*") || perms.has("deal:view_all")) {
    return base;
  }

  const conditions: Prisma.DealWhereInput[] = [];

  if (perms.has("deal:view_group")) {
    const groupMemberIds = await resolveGroupMemberIds(userId, organizationId);
    if (groupMemberIds.length > 0) {
      conditions.push({ ownerId: { in: groupMemberIds } });
    }
  }

  if (perms.has("deal:view_own")) {
    conditions.push({ ownerId: userId });
  }

  if (conditions.length === 0) return null;

  return { ...base, OR: conditions };
}
