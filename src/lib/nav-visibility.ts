import { UserRole } from "@prisma/client";

import type { SettingsNavGroup, SettingsNavItem } from "./settings-nav";

/**
 * Regras de visibilidade do menu — funcao pura, sem dependencias de
 * React/Next, serve tanto no cliente quanto no server.
 *
 * Regra de ouro:
 *  - Super-admin (EduIT) enxerga TUDO — bypass total.
 *  - Item sem `allowedRoles` eh visivel pra qualquer role.
 *  - Item com `allowedRoles` so aparece se o role do user estiver na lista.
 *
 * Quando o backend ganhar uma tabela `RolePermission` (override por
 * organizacao), a unica alteracao necessaria sera a fonte dos
 * `allowedRoles` — essas funcoes continuam identicas.
 */

export type Viewer = {
  role: UserRole | null | undefined;
  isSuperAdmin: boolean;
  permissions?: ReadonlySet<string> | string[] | null;
  hiddenRoutes?: string[];
  hiddenSettingsItemIds?: string[];
};

export function canSeeItem(
  item: { allowedRoles?: UserRole[]; requiredPermission?: string; href?: string | null; id?: string },
  viewer: Viewer,
): boolean {
  if (viewer.isSuperAdmin) return true;
  const isAdminRole = viewer.role === UserRole.ADMIN;
  const perms =
    viewer.permissions instanceof Set
      ? viewer.permissions
      : new Set(viewer.permissions ?? []);
  if (
    item.requiredPermission &&
    !isAdminRole &&
    !perms.has("*") &&
    !perms.has(item.requiredPermission)
  ) {
    return false;
  }
  if (!item.allowedRoles || item.allowedRoles.length === 0) return true;
  if (!viewer.role) return false;
  return item.allowedRoles.includes(viewer.role);
}

/**
 * Filtra grupos do settings nav. Grupos ficam de fora se nenhum
 * dos itens for visivel — evita categoria vazia na sidebar.
 */
export function filterSettingsNav(
  groups: SettingsNavGroup[],
  viewer: Viewer,
): SettingsNavGroup[] {
  const hidden = new Set(viewer.hiddenSettingsItemIds ?? []);
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !hidden.has(item.id) && canSeeItem(item, viewer)),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * Filtro generico pra itens da sidebar principal (dashboard-shell) —
 * mesma semantica, sem noção de grupo.
 */
export function filterItemsByRole<T extends { allowedRoles?: UserRole[] }>(
  items: T[],
  viewer: Viewer,
): T[] {
  const hiddenRoutes = viewer.hiddenRoutes ?? [];
  return items.filter((item) => {
    const asRecord = item as unknown as { href?: string; id?: string; requiredPermission?: string };
    if (asRecord.href && hiddenRoutes.includes(asRecord.href)) return false;
    return canSeeItem(
      item as unknown as { allowedRoles?: UserRole[]; requiredPermission?: string; href?: string | null; id?: string },
      viewer,
    );
  });
}

/**
 * Defaults recomendados pra sidebar principal. Hoje usamos so na
 * sidebar vertical do dashboard-shell — expostos aqui pra que outros
 * consumidores (mobile bottom nav, cmdk palette) possam reaproveitar.
 *
 * Regra geral: MEMBER nao vê configuracoes nem ferramentas
 * administrativas. Ve so o que opera no dia a dia.
 */
export const SIDEBAR_ROLE_MATRIX: Record<string, UserRole[] | undefined> = {
  // Operacional — todos
  "/dashboard": undefined,
  "/pipeline": undefined,
  "/inbox": undefined,
  "/tasks": undefined,
  "/contacts": undefined,
  "/companies": undefined,
  // Gestao
  "/automations": [UserRole.ADMIN, UserRole.MANAGER],
  "/ai-agents": [UserRole.ADMIN, UserRole.MANAGER],
  "/campaigns": [UserRole.ADMIN, UserRole.MANAGER],
  "/analytics": [UserRole.ADMIN, UserRole.MANAGER],
  "/analytics/inbox": [UserRole.ADMIN, UserRole.MANAGER],
  "/reports": [UserRole.ADMIN, UserRole.MANAGER],
  // Developer area — so ADMIN
  "/developers": [UserRole.ADMIN],
  // Settings — todos enxergam, conteudo interno eh filtrado por grupo
  "/settings": undefined,
};

/**
 * Rotas fora do rail da sidebar mas ainda sujeitas ao allow list granular
 * (`scopeGrants.sidebar.routes`). Usado junto com hrefs de nav/bottom.
 */
export const SIDEBAR_GRANULAR_EXTRA_HREFS = ["/analytics/inbox"] as const;

export function computeHiddenSidebarRoutesFromAllowList(
  trackedHrefs: readonly string[],
  sidebarAllowList: string[] | undefined,
): string[] {
  if (!Array.isArray(sidebarAllowList) || sidebarAllowList.includes("*")) return [];
  return trackedHrefs.filter((href) => !sidebarAllowList.includes(href));
}
