import { Prisma } from "@prisma/client";

import type { AppUserRole } from "@/lib/auth-types";
import { loadAuthzContext } from "@/lib/authz";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { getOrgSettingsByPrefix } from "@/lib/org-settings";
import { prisma } from "@/lib/prisma";
import { getOrgIdOrThrow } from "@/lib/request-context";

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

/**
 * Compõe o escopo de departamento (isolamento) com o `where` base de
 * conversas via AND. Modelo opt-in e aditivo-restritivo:
 * - `deptIds === null` → sem restrição de departamento (comportamento legado).
 * - `deptIds` não-vazio → conversa DEVE pertencer a um dos departamentos.
 * O escopo é sempre combinado com AND para não afrouxar a visibilidade base
 * (own/all/grupos) — só restringe, nunca expande.
 */
export function composeDepartmentScope(
  base: Prisma.ConversationWhereInput,
  deptIds: string[] | null
): Prisma.ConversationWhereInput {
  if (!deptIds || deptIds.length === 0) return base;
  const deptWhere: Prisma.ConversationWhereInput = {
    departmentId: { in: deptIds },
  };
  if (!base || Object.keys(base).length === 0) return deptWhere;
  return { AND: [deptWhere, base] };
}

/**
 * Resolve os departamentos que o usuário pode ver, a partir de
 * `AgentPermission.allowedDepartmentIds`. Isolamento de dados por
 * departamento (fecha o gap em que o campo era persistido mas não aplicado).
 *
 * - ADMIN → `null` (vê todos os departamentos, sem restrição).
 * - Demais papéis → `allowedDepartmentIds` se configurado; senão `null`
 *   (opt-in: enquanto o admin não escopar o agente, nada muda).
 */
export async function getDepartmentScopeForConversations(
  user: SessionUser
): Promise<string[] | null> {
  if (user.role === "ADMIN") return null;
  try {
    const perm = await prisma.agentPermission.findUnique({
      where: { userId: user.id },
      select: { allowedDepartmentIds: true },
    });
    const ids = perm?.allowedDepartmentIds ?? [];
    return ids.length > 0 ? ids : null;
  } catch {
    // Tabela/coluna ausente (migração pendente) ou fora de contexto — sem restrição.
    return null;
  }
}

export async function getVisibilityFilter(
  user: SessionUser
): Promise<VisibilityResult> {
  const role = user.role;
  const deptScope = await getDepartmentScopeForConversations(user);

  if (!role || !DEFAULTS[role]) {
    return {
      canSeeAll: true,
      dealWhere: {},
      conversationWhere: composeDepartmentScope({}, deptScope),
    };
  }

  const settings = await loadVisibilityMap();
  const mode = getModeForRole(settings, role);

  if (mode === "all") {
    return {
      canSeeAll: true,
      dealWhere: {},
      conversationWhere: composeDepartmentScope({}, deptScope),
    };
  }

  /**
   * Modo "own" do papel. A "caixa de entrada compartilhada" (extra do PAPEL,
   * atrás da flag `rbac_granular_scope_v1`) decide se o agente enxerga
   * conversas não atribuídas via contato:
   *   - sharedInbox=true (default) → vê conversas próprias + não atribuídas
   *     ligadas a contatos que ele acompanha.
   *   - sharedInbox=false → estritamente as conversas atribuídas a ele.
   * ADMIN e flag desligada mantêm o comportamento compartilhado.
   */
  let strictOwnInbox = false;
  try {
    const orgId = getOrgIdOrThrow();
    if (await isFeatureEnabled("rbac_granular_scope_v1", orgId)) {
      const ctx = await loadAuthzContext({
        userId: user.id,
        organizationId: orgId,
        isSuperAdmin: false,
      });
      if (!ctx.isAdmin && !ctx.sharedInbox) strictOwnInbox = true;
    }
  } catch {
    // Fora de RequestContext (ex.: jobs) — mantém comportamento compartilhado.
  }

  return {
    canSeeAll: false,
    dealWhere: { ownerId: user.id },
    /**
     * Inbox: conversa atribuída só ao agente indicado; sem atribuição segue a visibilidade por contato
     * (dono do negócio ou responsável pelo lead). Sobre isso aplica-se ainda
     * o isolamento por departamento (AND), quando configurado.
     */
    conversationWhere: composeDepartmentScope(
      strictOwnInbox
        ? { assignedToId: user.id }
        : {
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
      deptScope
    ),
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
