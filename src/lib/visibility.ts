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

  // MEMBER nunca vê "Sem responsável" (deal/conversa sem dono) — mesmo com
  // visibility.MEMBER=all. Só ADMIN/MANAGER enxergam a fila não atribuída
  // no pipeline/inbox compartilhado.
  if (mode === "all") {
    if (role === "MEMBER") {
      // Conversa ATRIBUÍDA ao agente é sempre visível a ele — inclusive fora
      // do seu departamento. Sem o `OR assignedToMe`, um escopo de
      // departamento (AND) escondia até as próprias conversas do agente
      // quando elas chegavam sem `departmentId` (ex.: recém-distribuídas),
      // e a fila dele aparecia vazia mesmo em modo "all".
      const seeAllAssigned = composeDepartmentScope(
        { assignedToId: { not: null } },
        deptScope,
      );
      return {
        canSeeAll: true,
        dealWhere: { ownerId: { not: null } },
        conversationWhere: deptScope
          ? { OR: [{ assignedToId: user.id }, seeAllAssigned] }
          : seeAllAssigned,
      };
    }
    return {
      canSeeAll: true,
      dealWhere: {},
      conversationWhere: composeDepartmentScope({}, deptScope),
    };
  }

  /**
   * Modo "own" do papel.
   *
   * MEMBER: default estrito (só atribuídas a ele). Filas compartilhadas
   * (Entrada / Automação) NÃO usam mais `sharedInbox` — liberar via
   * `inbox:tab:entrada` + `conversation:claim` e `inbox:tab:automacao`,
   * aplicadas em `withInboxQueueVisibility` na listagem da inbox.
   *
   * Demais papéis (com flag `rbac_granular_scope_v1`):
   *   - sharedInbox=true (default) → próprias + não atribuídas ligadas a
   *     contatos que o agente acompanha.
   *   - sharedInbox=false → estritamente as atribuídas a ele.
   */
  let strictOwnInbox = role === "MEMBER";
  if (!strictOwnInbox) {
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
  }

  // Conversa ATRIBUÍDA ao agente é SEMPRE visível — inclusive sem departamento
  // ou de outro departamento. Sem isso, uma conversa distribuída para o agente
  // (que chega sem `departmentId`) era escondida pelo isolamento por
  // departamento (AND), e o agente "não via a conversa distribuída".
  const assignedToMe: Prisma.ConversationWhereInput = { assignedToId: user.id };

  if (strictOwnInbox) {
    return {
      canSeeAll: false,
      dealWhere: { ownerId: user.id },
      conversationWhere: assignedToMe,
    };
  }

  // Pool compartilhado (não atribuídas ligadas a contatos que o agente
  // acompanha): AQUI sim vale o isolamento por departamento.
  const sharedUnassigned: Prisma.ConversationWhereInput = {
    assignedToId: null,
    contact: {
      OR: [
        { deals: { some: { ownerId: user.id } } },
        { assignedToId: user.id },
      ],
    },
  };

  return {
    canSeeAll: false,
    dealWhere: { ownerId: user.id },
    conversationWhere: {
      OR: [assignedToMe, composeDepartmentScope(sharedUnassigned, deptScope)],
    },
  };
}

function permissionsAllowKey(
  perms: ReadonlySet<string>,
  key: string,
): boolean {
  if (perms.has("*") || perms.has(key)) return true;
  const colon = key.indexOf(":");
  if (colon > 0 && perms.has(`${key.slice(0, colon)}:*`)) return true;
  return false;
}

/**
 * Amplia o `conversationWhere` para filas compartilhadas da Inbox quando o
 * operador tem as chaves correspondentes:
 *   - `inbox:tab:entrada` + `conversation:claim` → pool OPEN não atribuído
 *   - `inbox:tab:automacao` → fila de automação (RUNNING / assignee IA)
 *
 * Substitui o legado `sharedInbox` para MEMBER nas filas Entrada/Automação.
 * Seguro combinar com o filtro de aba (`tabToWhere`) — extras só aparecem
 * nas abas cujo predicado as inclui.
 *
 * `base` vazio = irrestrito (ADMIN/MANAGER “all”). Nesse caso NÃO aplicar
 * extras: senão a inbox inteira colapsa só para Entrada/Automação.
 */
export function withInboxQueueVisibility(
  base: Prisma.ConversationWhereInput,
  args: {
    permissions: ReadonlySet<string> | readonly string[];
    tabs?: Array<"entrada" | "automacao">;
  },
): Prisma.ConversationWhereInput {
  // Irrestrito: não restringir às filas compartilhadas.
  if (!base || Object.keys(base).length === 0) {
    return base ?? {};
  }

  const perms =
    args.permissions instanceof Set
      ? args.permissions
      : new Set(args.permissions);
  const tabs = args.tabs ?? (["entrada", "automacao"] as const);
  const extras: Prisma.ConversationWhereInput[] = [];

  if (
    tabs.includes("entrada") &&
    permissionsAllowKey(perms, "inbox:tab:entrada") &&
    permissionsAllowKey(perms, "conversation:claim")
  ) {
    extras.push({ assignedToId: null, status: "OPEN" });
  }

  if (tabs.includes("automacao") && permissionsAllowKey(perms, "inbox:tab:automacao")) {
    extras.push({
      status: "OPEN",
      OR: [
        {
          assignedToId: null,
          contact: {
            automationContexts: { some: { status: "RUNNING" } },
          },
        },
        { assignedTo: { is: { type: "AI" } } },
      ],
    });
  }

  if (extras.length === 0) return base;
  return { OR: [base, ...extras] };
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
