/**
 * Resolução de permissões efetivas — Permissions v2 (Sprint 1, Fase 2).
 *
 * Combina três fontes para chegar nas permissions/grants finais de um
 * usuário (ADR-3 — herança):
 *   1. UserRoleAssignment direto (role atribuída individualmente).
 *   2. UserGroupMember.role (override por membro dentro do grupo).
 *   3. UserGroup.role (role padrão do grupo, herdada).
 *
 * Regra de prioridade: UserRoleAssignment direto NÃO substitui o role do
 * grupo — ambos somam. A "intersecção" mencionada no ADR refere-se a
 * `channelGrants`/`stageGrants` (= união entre grupos, [] = sem restrição).
 *
 * Para permissions stricto sensu, sempre UNIMOS — quanto mais grupos, mais
 * permissions. Para channels/stages, [] = sem restrição (acesso total),
 * então qualquer grupo sem restrição libera tudo.
 */
import { prisma } from "@/lib/prisma";

/**
 * Lista flat de permission keys efetivas do usuário (já deduplicada).
 *
 * Inclui keys de:
 *  - Role direta (`UserRoleAssignment`)
 *  - Role override do membro no grupo (`UserGroupMember.role`)
 *  - Role padrão do grupo (`UserGroup.role`)
 *
 * Não expande wildcards (`*` ou `resource:*`) — quem consome usa `can()`
 * que já trata wildcards. Retornar a chave bruta preserva semântica.
 */
export async function resolveEffectivePermissions(
  userId: string,
  organizationId: string,
): Promise<string[]> {
  const permissions = new Set<string>();

  // 1. Roles diretas do usuário (M:N — unir todas)
  const directs = await prisma.userRoleAssignment.findMany({
    where: { userId, organizationId },
    include: { role: { select: { permissions: true } } },
  });
  for (const d of directs) {
    for (const p of d.role.permissions) permissions.add(p);
  }

  // 2 + 3. Roles via grupos (override individual OU role do grupo)
  const memberships = await prisma.userGroupMember.findMany({
    where: { userId, group: { organizationId } },
    include: {
      role: { select: { permissions: true } }, // override individual
      group: {
        select: {
          role: { select: { permissions: true } }, // role padrão do grupo
        },
      },
    },
  });

  for (const m of memberships) {
    // Override individual prevalece sobre role do grupo
    const effective = m.role ?? m.group.role;
    if (effective) {
      for (const p of effective.permissions) permissions.add(p);
    }
  }

  return Array.from(permissions);
}

/**
 * Resolução de `channelGrants` efetivos (Fase 4).
 *
 * Semântica:
 *  - `[]` retornado = sem restrição (acesso a TODOS os canais).
 *  - Qualquer grupo com `channelGrants = []` libera tudo (curto-circuito).
 *  - Usuário sem nenhum grupo = sem restrição (operadores standalone).
 *  - Caso contrário, retorna a UNIÃO dos grants de todos os grupos.
 *
 * Identificadores aceitos:
 *   "whatsapp"           → todos os canais WhatsApp
 *   "whatsapp:ch_abc123" → canal WhatsApp específico
 */
export async function resolveChannelGrants(userId: string): Promise<string[]> {
  const memberships = await prisma.userGroupMember.findMany({
    where: { userId },
    select: { group: { select: { channelGrants: true } } },
  });

  if (memberships.length === 0) return []; // sem grupo = sem restrição

  const grants = new Set<string>();
  for (const m of memberships) {
    // Curto-circuito: [] em qualquer grupo = sem restrição
    if (m.group.channelGrants.length === 0) return [];
    for (const c of m.group.channelGrants) grants.add(c);
  }
  return Array.from(grants);
}

/**
 * Resolução de `stageGrants` efetivos (Fase 5).
 *
 * Mesma semântica de `resolveChannelGrants`:
 *  - `[]` retornado = todas as fases visíveis.
 *  - Qualquer grupo sem restrição libera tudo.
 *  - União dos stageIds em todos os grupos do usuário.
 */
export async function resolveStageGrants(userId: string): Promise<string[]> {
  const memberships = await prisma.userGroupMember.findMany({
    where: { userId },
    select: { group: { select: { stageGrants: true } } },
  });

  if (memberships.length === 0) return [];

  const grants = new Set<string>();
  for (const m of memberships) {
    if (m.group.stageGrants.length === 0) return [];
    for (const s of m.group.stageGrants) grants.add(s);
  }
  return Array.from(grants);
}
