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

export type ScopeGrants = {
  /** Abas da Inbox por papel (`MEMBER`). Valores: chaves de aba ou `"*"`. */
  inbox?: {
    tabs?: RoleScope;
  };
  pipeline?: {
    view?: RoleScope;
    edit?: RoleScope;
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
};

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

export function parseScopeGrants(input: unknown): ScopeGrants {
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const pipeline = src.pipeline && typeof src.pipeline === "object" ? (src.pipeline as Record<string, unknown>) : {};
  const stage = src.stage && typeof src.stage === "object" ? (src.stage as Record<string, unknown>) : {};
  const field = src.field && typeof src.field === "object" ? (src.field as Record<string, unknown>) : {};
  const sidebar = src.sidebar && typeof src.sidebar === "object" ? (src.sidebar as Record<string, unknown>) : {};
  const inbox = src.inbox && typeof src.inbox === "object" ? (src.inbox as Record<string, unknown>) : {};
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
  };
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

export function canSeeInboxTab(args: {
  grants: ScopeGrants;
  role: string | null | undefined;
  tab: InboxTab;
}): boolean {
  if (args.tab === "todos") return true;
  const role = asRoleKey(args.role);
  if (!role || role === "ADMIN" || role === "MANAGER") return true;
  const scope = args.grants.inbox?.tabs;
  if (!hasRoleRule(scope, "MEMBER")) {
    return DEFAULT_MEMBER_INBOX_TABS.has(args.tab);
  }
  return roleRuleAllows(scope, "MEMBER", args.tab);
}

export function listAllowedInboxTabsForUser(args: {
  grants: ScopeGrants;
  role: string | null | undefined;
}): InboxTab[] {
  const role = asRoleKey(args.role);
  if (!role || role === "ADMIN" || role === "MANAGER") {
    return ["todos", ...INBOX_CATEGORY_TAB_ORDER];
  }
  const allowed = INBOX_CATEGORY_TAB_ORDER.filter((t) =>
    canSeeInboxTab({ grants: args.grants, role, tab: t }),
  );
  const base: Exclude<InboxTab, "todos">[] =
    allowed.length > 0 ? [...allowed] : ["esperando", "respondidas"];
  return ["todos", ...base];
}
