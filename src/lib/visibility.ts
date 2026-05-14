import { Prisma } from "@prisma/client";

import type { AppUserRole } from "@/lib/auth-types";
import { getOrgSettingsByPrefix } from "@/lib/org-settings";

export type VisibilityMode = "all" | "own";

export type VisibilityResult = {
  canSeeAll: boolean;
  dealWhere: Prisma.DealWhereInput;
  conversationWhere: Prisma.ConversationWhereInput;
};

type SessionUser = { id: string; role: AppUserRole };

const DEFAULTS: Record<AppUserRole, VisibilityMode> = {
  ADMIN: "all",
  MANAGER: "all",
  MEMBER: "own",
};

/**
 * Lê settings da org corrente.
 *
 * Multi-tenancy v0 cutover: antes lia de `SystemSetting` (global, vazava
 * config entre tenants). Agora le de `OrganizationSetting` via
 * `getOrgSettingsByPrefix`, que é cacheado por (orgId, prefixo) e
 * invalidado em `setVisibilityForRole`.
 */
async function loadVisibilityMap(): Promise<Map<string, string>> {
  return getOrgSettingsByPrefix("visibility.");
}

function getModeForRole(
  settings: Map<string, string>,
  role: AppUserRole
): VisibilityMode {
  if (role === "ADMIN") return "all";
  const val = settings.get(`visibility.${role}`);
  if (val === "all" || val === "own") return val;
  return DEFAULTS[role];
}

export async function getVisibilityFilter(
  user: SessionUser
): Promise<VisibilityResult> {
  const role = user.role;

  if (!role || !DEFAULTS[role]) {
    return { canSeeAll: true, dealWhere: {}, conversationWhere: {} };
  }

  const settings = await loadVisibilityMap();
  const mode = getModeForRole(settings, role);

  if (mode === "all") {
    return {
      canSeeAll: true,
      dealWhere: {},
      conversationWhere: {},
    };
  }

  return {
    canSeeAll: false,
    dealWhere: { ownerId: user.id },
    /**
     * Inbox: conversa atribuída só ao agente indicado; sem atribuição segue a visibilidade por contato
     * (dono do negócio ou responsável pelo lead).
     */
    conversationWhere: {
      OR: [
        { assignedToId: user.id },
        {
          assignedToId: null,
          contact: {
            OR: [
              { deals: { some: { ownerId: user.id } } },
              { assignedToId: user.id },
            ],
          },
        },
      ],
    },
  };
}

export async function getVisibilitySettings(): Promise<
  Record<string, VisibilityMode>
> {
  const settings = await loadVisibilityMap();
  return {
    ADMIN: "all",
    MANAGER: getModeForRole(settings, "MANAGER"),
    MEMBER: getModeForRole(settings, "MEMBER"),
  };
}

export async function setVisibilityForRole(
  role: "MANAGER" | "MEMBER",
  mode: VisibilityMode
) {
  // setOrgSetting já invalida o cache (chave + prefixo) automaticamente.
  const { setOrgSetting } = await import("@/lib/org-settings");
  await setOrgSetting(`visibility.${role}`, mode);
}

/**
 * @deprecated O cache agora é gerenciado em `lib/org-settings.ts` via
 * Redis + invalidação automática em `setOrgSetting`. Esta função
 * permanece como no-op para manter compatibilidade com chamadas
 * antigas (ex.: testes).
 */
export function clearVisibilityCache() {
  // no-op — cache movido para `lib/cache` org-aware.
}
