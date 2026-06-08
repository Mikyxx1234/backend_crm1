/**
 * Helper de permissões efetivas para rotas — Permissions v2 (Sprint 4).
 *
 * Wrapper sobre `resolveEffectivePermissions` que retorna Set<string>
 * pronto para usar com `buildDealWhere`, `buildConversationWhere` e
 * checagens inline com `perms.has(key)`.
 */
import { resolveEffectivePermissions } from "./resolve-permissions";

/**
 * Retorna o Set de permissões efetivas do usuário.
 *
 * Combina:
 *   - Roles diretas (UserRoleAssignment)
 *   - Roles de grupo com override individual (UserGroupMember.roleId)
 *   - Roles padrão de grupo (UserGroup.roleId)
 *
 * Cache de authz (Redis TTL 60s) é gerenciado por `loadAuthzContext`
 * em `@/lib/authz/index.ts` — este helper vai direto ao banco via
 * `resolveEffectivePermissions` pois é usado fora do hot-path de session.
 */
export async function getEffectivePerms(
  userId: string,
  organizationId: string,
): Promise<Set<string>> {
  const arr = await resolveEffectivePermissions(userId, organizationId);
  return new Set(arr);
}
