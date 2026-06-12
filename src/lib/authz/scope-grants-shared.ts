/**
 * Lógica de grants sem I/O — seguro para import em Client Components.
 * (Não importar Prisma/request-context aqui.)
 */

/**
 * Deve coincidir com `InboxTab` em `@/services/conversations`.
 * "todos" não entra em grants por categoria — é aba agregadora.
 */
export type InboxTab =
  | "entrada"
  | "esperando"
  | "respondidas"
  | "automacao"
  | "finalizados"
  | "erro"
  | "todos";

/** Ordem das categorias na inbox (sem "todos") — manter alinhado a `INBOX_CATEGORY_TABS` no serviço. */
const INBOX_CATEGORY_TAB_ORDER: readonly Exclude<InboxTab, "todos">[] = [
  "entrada",
  "esperando",
  "respondidas",
  "automacao",
  "finalizados",
  "erro",
];

type RoleKey = "ADMIN" | "MANAGER" | "MEMBER";
type RoleScope = Partial<Record<RoleKey, string[]>>;

/**
 * Override por usuário individual para ações do CRM.
 *
 * 29/mai/26 — adicionado para suportar a tela `/settings/permissions` no
 * frontend, que define toggles por usuário (não por papel) para 3 ações:
 *
 *   - `editLeads`     — mover deals entre estágios + editar campos
 *   - `runAutomations`— disparar automações manualmente
 *   - `assignOwner`   — atribuir/trocar responsável
 *
 * Schema: `crm.<action>.users[userId] = boolean`
 *   - `true`  → override permissivo (passa mesmo se RBAC negar)
 *   - `false` → override restritivo (bloqueia mesmo se RBAC permitir)
 *   - chave ausente → segue regra do RBAC (`Role` + `UserRoleAssignment`)
 *
 * Quem consome: `requirePermissionForUser` (`resource-policy.ts`) faz o
 * lookup ANTES de retornar 403, mapeando `PermissionKey` → `CrmActionKey`
 * via `RBAC_TO_CRM_ACTION`.
 */
export type CrmActionKey = "editLeads" | "runAutomations" | "assignOwner";
type CrmActionUserGrants = Partial<Record<string, boolean>>;
export type CrmActionGrants = Partial<
  Record<CrmActionKey, { users?: CrmActionUserGrants }>
>;

/**
 * Override por usuário individual (não por papel) para escopo de recursos
 * com instâncias dinâmicas — funis e canais.
 *
 * Schema: `users[userId] = string[]`
 *   - `["*"]`           → acesso a todos (equivale a "sem restrição")
 *   - `["id1","id2"]`   → restrito a esses IDs
 *   - `[]`              → nenhum acesso (restrição total)
 *   - chave ausente     → cai na regra por papel (`pipeline.view[role]`) ou,
 *                          quando não houver, libera (default permissivo)
 *
 * 09/jun/26 — adicionado para suportar escopo por usuário de funis
 * (`pipeline.users`) e canais (`channel.view/send.users`), configurável na
 * tela de cada usuário em /settings/permissions.
 */
export type UserScopeGrants = Partial<Record<string, string[]>>;

export type ScopeGrants = {
  /** Abas da Inbox por papel (`MEMBER`). Valores: chaves de aba ou `"*"`. */
  inbox?: {
    tabs?: RoleScope;
  };
  pipeline?: {
    view?: RoleScope;
    edit?: RoleScope;
    /** Override por usuário: lista de IDs de funis visíveis (ou `["*"]`). */
    users?: UserScopeGrants;
  };
  /**
   * Escopo de canais (instâncias dinâmicas de `Channel`). Diferente de
   * pipeline/stage, não existe regra legada por papel — só override por
   * usuário, separando "ver" e "enviar".
   */
  channel?: {
    view?: { users?: UserScopeGrants };
    send?: { users?: UserScopeGrants };
  };
  stage?: {
    view?: RoleScope;
    move?: RoleScope;
    edit?: RoleScope;
  };
  field?: {
    deal?: {
      view?: RoleScope;
      edit?: RoleScope;
    };
    contact?: {
      view?: RoleScope;
      edit?: RoleScope;
    };
    product?: {
      view?: RoleScope;
      edit?: RoleScope;
    };
  };
  sidebar?: {
    routes?: RoleScope;
    settingsItems?: RoleScope;
  };
  /**
   * Overrides por usuário para 3 ações de alto nível do CRM. Configurado
   * via UI em /settings/permissions; consultado em
   * `requirePermissionForUser` como fallback permissivo quando o RBAC
   * tradicional negaria.
   */
  crm?: CrmActionGrants;
};

export const CRM_ACTION_KEYS: readonly CrmActionKey[] = [
  "editLeads",
  "runAutomations",
  "assignOwner",
] as const;

function asRoleKey(role: string | null | undefined): RoleKey | null {
  if (role === "ADMIN" || role === "MANAGER" || role === "MEMBER") return role;
  return null;
}

function normalizeIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function normalizeRoleScope(input: unknown): RoleScope {
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    ADMIN: normalizeIds(src.ADMIN),
    MANAGER: normalizeIds(src.MANAGER),
    MEMBER: normalizeIds(src.MEMBER),
  };
}

function normalizeUserScope(input: unknown): UserScopeGrants {
  if (!input || typeof input !== "object") return {};
  const src = input as Record<string, unknown>;
  const out: UserScopeGrants = {};
  for (const [userId, raw] of Object.entries(src)) {
    if (typeof userId !== "string" || !userId) continue;
    out[userId] = normalizeIds(raw);
  }
  return out;
}

function normalizeCrmUserGrants(input: unknown): CrmActionUserGrants {
  if (!input || typeof input !== "object") return {};
  const src = input as Record<string, unknown>;
  const out: CrmActionUserGrants = {};
  for (const [userId, raw] of Object.entries(src)) {
    if (typeof userId !== "string" || !userId) continue;
    if (typeof raw === "boolean") out[userId] = raw;
  }
  return out;
}

function normalizeCrmGrants(input: unknown): CrmActionGrants {
  if (!input || typeof input !== "object") return {};
  const src = input as Record<string, unknown>;
  const out: CrmActionGrants = {};
  for (const action of CRM_ACTION_KEYS) {
    const node = src[action];
    if (!node || typeof node !== "object") continue;
    const usersRaw = (node as Record<string, unknown>).users;
    out[action] = { users: normalizeCrmUserGrants(usersRaw) };
  }
  return out;
}

export function parseScopeGrants(input: unknown): ScopeGrants {
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const pipeline = src.pipeline && typeof src.pipeline === "object" ? (src.pipeline as Record<string, unknown>) : {};
  const stage = src.stage && typeof src.stage === "object" ? (src.stage as Record<string, unknown>) : {};
  const field = src.field && typeof src.field === "object" ? (src.field as Record<string, unknown>) : {};
  const sidebar = src.sidebar && typeof src.sidebar === "object" ? (src.sidebar as Record<string, unknown>) : {};
  const inbox = src.inbox && typeof src.inbox === "object" ? (src.inbox as Record<string, unknown>) : {};
  const channel = src.channel && typeof src.channel === "object" ? (src.channel as Record<string, unknown>) : {};
  const channelView = channel.view && typeof channel.view === "object" ? (channel.view as Record<string, unknown>) : {};
  const channelSend = channel.send && typeof channel.send === "object" ? (channel.send as Record<string, unknown>) : {};
  const dealField = field.deal && typeof field.deal === "object" ? (field.deal as Record<string, unknown>) : {};
  const contactField = field.contact && typeof field.contact === "object" ? (field.contact as Record<string, unknown>) : {};
  const productField = field.product && typeof field.product === "object" ? (field.product as Record<string, unknown>) : {};
  return {
    inbox: {
      tabs: normalizeRoleScope(inbox.tabs),
    },
    pipeline: {
      view: normalizeRoleScope(pipeline.view),
      edit: normalizeRoleScope(pipeline.edit),
      users: normalizeUserScope(pipeline.users),
    },
    channel: {
      view: { users: normalizeUserScope(channelView.users) },
      send: { users: normalizeUserScope(channelSend.users) },
    },
    stage: {
      view: normalizeRoleScope(stage.view),
      move: normalizeRoleScope(stage.move),
      edit: normalizeRoleScope(stage.edit),
    },
    field: {
      deal: {
        view: normalizeRoleScope(dealField.view),
        edit: normalizeRoleScope(dealField.edit),
      },
      contact: {
        view: normalizeRoleScope(contactField.view),
        edit: normalizeRoleScope(contactField.edit),
      },
      product: {
        view: normalizeRoleScope(productField.view),
        edit: normalizeRoleScope(productField.edit),
      },
    },
    sidebar: {
      routes: normalizeRoleScope(sidebar.routes),
      settingsItems: normalizeRoleScope(sidebar.settingsItems),
    },
    crm: normalizeCrmGrants(src.crm),
  };
}

/**
 * Lê o override por usuário para uma ação do CRM. Retorna `true | false`
 * (override explícito) ou `null` (sem override — segue a regra do RBAC).
 *
 * Mantém-se em scope-grants-shared (zero I/O) pra ser usável tanto no
 * backend (resource-policy) quanto em código compartilhado eventual.
 */
export function readCrmActionGrant(
  grants: ScopeGrants,
  action: CrmActionKey,
  userId: string,
): boolean | null {
  const node = grants.crm?.[action];
  if (!node) return null;
  const value = node.users?.[userId];
  if (value === true || value === false) return value;
  return null;
}

function hasRoleRule(scope: RoleScope | undefined, role: RoleKey): boolean {
  if (!scope) return false;
  return Array.isArray(scope[role]);
}

function roleRuleAllows(scope: RoleScope | undefined, role: RoleKey, value: string): boolean {
  const ids = scope?.[role];
  if (!ids || ids.length === 0) return true;
  if (ids.includes("*")) return true;
  return ids.includes(value);
}

export function canAccessScopedResource(args: {
  grants: ScopeGrants;
  role: string | null | undefined;
  resource: "pipeline" | "stage";
  action: "view" | "edit" | "move";
  targetId: string;
}): boolean {
  const role = asRoleKey(args.role);
  if (!role || role === "ADMIN") return true;
  const scope =
    args.resource === "pipeline"
      ? args.action === "view"
        ? args.grants.pipeline?.view
        : args.grants.pipeline?.edit
      : args.action === "view"
        ? args.grants.stage?.view
        : args.action === "edit"
          ? args.grants.stage?.edit
          : args.grants.stage?.move;
  if (!hasRoleRule(scope, role)) return true;
  return roleRuleAllows(scope, role, args.targetId);
}

/**
 * Avalia uma lista de IDs de override por usuário.
 * `["*"]` → libera tudo; lista vazia → nega; senão precisa conter o alvo.
 */
function userScopeAllows(ids: string[], value: string): boolean {
  if (ids.includes("*")) return true;
  return ids.includes(value);
}

/**
 * Acesso (view) a um funil considerando override por usuário e fallback
 * para a regra por papel. ADMIN sempre libera.
 */
export function canAccessPipelineForUser(args: {
  grants: ScopeGrants;
  role: string | null | undefined;
  userId: string;
  pipelineId: string;
}): boolean {
  if (asRoleKey(args.role) === "ADMIN") return true;
  const userRule = args.grants.pipeline?.users?.[args.userId];
  if (Array.isArray(userRule)) return userScopeAllows(userRule, args.pipelineId);
  return canAccessScopedResource({
    grants: args.grants,
    role: args.role,
    resource: "pipeline",
    action: "view",
    targetId: args.pipelineId,
  });
}

/**
 * Lista de IDs de funis permitidos a um usuário, para filtrar queries.
 * Retorna `null` quando não há restrição (acesso a todos); array (possivelmente
 * vazio) quando restrito.
 */
export function listAllowedPipelineIdsForUser(args: {
  grants: ScopeGrants;
  role: string | null | undefined;
  userId: string;
}): string[] | null {
  const role = asRoleKey(args.role);
  if (role === "ADMIN") return null;
  const userRule = args.grants.pipeline?.users?.[args.userId];
  if (Array.isArray(userRule)) {
    if (userRule.includes("*")) return null;
    return userRule;
  }
  if (!role) return null;
  const roleScope = args.grants.pipeline?.view?.[role];
  if (!Array.isArray(roleScope) || roleScope.length === 0 || roleScope.includes("*")) {
    return null;
  }
  return roleScope;
}

/**
 * Acesso a um canal (ver ou enviar) por usuário. "enviar" exige também
 * permissão de "ver". ADMIN sempre libera. Sem regra → liberado (canais não
 * tinham escopo antes desta feature).
 */
export function canAccessChannelForUser(args: {
  grants: ScopeGrants;
  role: string | null | undefined;
  userId: string;
  action: "view" | "send";
  channelId: string;
}): boolean {
  if (asRoleKey(args.role) === "ADMIN") return true;
  const viewRule = args.grants.channel?.view?.users?.[args.userId];
  if (Array.isArray(viewRule) && !userScopeAllows(viewRule, args.channelId)) {
    return false;
  }
  if (args.action === "send") {
    const sendRule = args.grants.channel?.send?.users?.[args.userId];
    if (Array.isArray(sendRule) && !userScopeAllows(sendRule, args.channelId)) {
      return false;
    }
  }
  return true;
}

/**
 * Lista de IDs de canais que o usuário pode ver, para filtrar conversas.
 * Retorna `null` quando não há restrição; array (possivelmente vazio) quando
 * restrito.
 */
export function listAllowedChannelIdsForUser(args: {
  grants: ScopeGrants;
  role: string | null | undefined;
  userId: string;
}): string[] | null {
  if (asRoleKey(args.role) === "ADMIN") return null;
  const rule = args.grants.channel?.view?.users?.[args.userId];
  if (!Array.isArray(rule)) return null;
  if (rule.includes("*")) return null;
  return rule;
}

export function canAccessField(args: {
  grants: ScopeGrants;
  role: string | null | undefined;
  entity: "deal" | "contact" | "product";
  action: "view" | "edit";
  fieldKey: string;
}): boolean {
  const role = asRoleKey(args.role);
  if (!role || role === "ADMIN") return true;
  const root = args.grants.field?.[args.entity];
  const scope = args.action === "view" ? root?.view : root?.edit;
  if (!hasRoleRule(scope, role)) return true;
  return roleRuleAllows(scope, role, args.fieldKey);
}

export function canSeeSidebarRoute(args: {
  grants: ScopeGrants;
  role: string | null | undefined;
  route: string;
}): boolean {
  const role = asRoleKey(args.role);
  if (!role || role === "ADMIN") return true;
  const scope = args.grants.sidebar?.routes;
  if (!hasRoleRule(scope, role)) return true;
  return roleRuleAllows(scope, role, args.route);
}

export function canSeeSettingsItem(args: {
  grants: ScopeGrants;
  role: string | null | undefined;
  itemId: string;
}): boolean {
  const role = asRoleKey(args.role);
  if (!role || role === "ADMIN") return true;
  const scope = args.grants.sidebar?.settingsItems;
  if (!hasRoleRule(scope, role)) return true;
  return roleRuleAllows(scope, role, args.itemId);
}

const DEFAULT_MEMBER_INBOX_TABS = new Set<InboxTab>(["esperando", "respondidas"]);

/**
 * Permissão RBAC mínima por aba de categoria (Authz v2 ↔ inbox).
 *
 * Modelo: "entrada" é a fila LIVRE (conversas sem resposta do agente) — só
 * faz sentido para quem pode ASSUMIR conversa da fila (`conversation:claim`).
 * As demais abas refletem o trabalho do agente e exigem apenas
 * `conversation:view`. Mantido alinhado ao catálogo em
 * `src/lib/authz/permissions.ts` (resource `conversation`).
 */
const INBOX_TAB_REQUIRED_PERMISSION: Record<Exclude<InboxTab, "todos">, string> = {
  entrada: "conversation:claim",
  esperando: "conversation:view",
  respondidas: "conversation:view",
  automacao: "conversation:view",
  finalizados: "conversation:view",
  erro: "conversation:view",
};

function toPermissionSet(
  permissions: ReadonlySet<string> | readonly string[] | null | undefined,
): ReadonlySet<string> | null {
  if (!permissions) return null;
  return permissions instanceof Set ? permissions : new Set(permissions);
}

/** Checa uma permission key respeitando wildcards `*` e `<resource>:*`. */
function permissionsAllow(perms: ReadonlySet<string>, key: string): boolean {
  if (perms.has("*") || perms.has(key)) return true;
  const colon = key.indexOf(":");
  if (colon > 0 && perms.has(`${key.slice(0, colon)}:*`)) return true;
  return false;
}

function memberTabAllowedByPermissions(
  perms: ReadonlySet<string>,
  tab: Exclude<InboxTab, "todos">,
): boolean {
  const required = INBOX_TAB_REQUIRED_PERMISSION[tab];
  if (!required) return false;
  return permissionsAllow(perms, required);
}

/**
 * Decide se um papel pode ver uma aba da inbox.
 *
 * Ordem de precedência para MEMBER:
 *   1. Regra explícita por papel configurada pela org (`inbox.tabs.MEMBER`,
 *      via /settings/permissions) — sempre vence (admin restringiu de propósito).
 *   2. Caso contrário, deriva do RBAC (`permissions`): o papel custom que
 *      concede `conversation:view`/`conversation:claim` libera as abas
 *      correspondentes. É a CONEXÃO entre o sistema de roles (Authz v2) e o
 *      gating do inbox, que antes era hardcoded no enum legado `User.role`.
 *   3. Sem info de permissões (callers legados/client) → default histórico
 *      (`esperando`/`respondidas`), preservando o fail-safe anterior.
 */
export function canSeeInboxTab(args: {
  grants: ScopeGrants;
  role: string | null | undefined;
  tab: InboxTab;
  permissions?: ReadonlySet<string> | readonly string[] | null;
}): boolean {
  if (args.tab === "todos") return true;
  const role = asRoleKey(args.role);
  if (!role || role === "ADMIN" || role === "MANAGER") return true;
  const scope = args.grants.inbox?.tabs;
  if (hasRoleRule(scope, "MEMBER")) {
    return roleRuleAllows(scope, "MEMBER", args.tab);
  }
  const perms = toPermissionSet(args.permissions);
  if (perms) {
    return memberTabAllowedByPermissions(perms, args.tab);
  }
  return DEFAULT_MEMBER_INBOX_TABS.has(args.tab);
}

export function listAllowedInboxTabsForUser(args: {
  grants: ScopeGrants;
  role: string | null | undefined;
  permissions?: ReadonlySet<string> | readonly string[] | null;
}): InboxTab[] {
  const role = asRoleKey(args.role);
  if (!role || role === "ADMIN" || role === "MANAGER") {
    return ["todos", ...INBOX_CATEGORY_TAB_ORDER];
  }
  const allowed = INBOX_CATEGORY_TAB_ORDER.filter((t) =>
    canSeeInboxTab({ grants: args.grants, role, tab: t, permissions: args.permissions }),
  );
  const base: Exclude<InboxTab, "todos">[] =
    allowed.length > 0 ? [...allowed] : ["esperando", "respondidas"];
  return ["todos", ...base];
}
