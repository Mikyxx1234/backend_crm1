/**
 * Catalogo CENTRAL dos modulos do app mobile.
 *
 * Fonte unica da verdade — usado tanto pela pagina de configuracao
 * (/settings/mobile-layout) quanto pelo runtime do MobileBottomNav
 * e MobileMoreSheet. Adicionar um modulo novo ao app significa
 * adicionar uma entrada AQUI, e ele automaticamente vira opcao no
 * Layout Builder.
 *
 * Nao importamos icons aqui (server-safe) — apenas o nome do icone
 * lucide-react. A resolucao do componente Icon acontece no client.
 */

export type MobileModuleId =
  | "inbox"
  | "pipeline"
  | "tasks"
  | "contacts"
  | "companies"
  | "campaigns"
  | "automations"
  | "reports"
  | "monitor"
  | "settings"
  | "profile";

export interface MobileModuleDescriptor {
  id: MobileModuleId;
  /** Rotulo exibido no bottom nav e no MoreSheet. */
  label: string;
  /** Rota Next a navegar ao clicar. */
  href: string;
  /** Nome do icone lucide-react (PascalCase). */
  iconName: string;
  /** Descricao curta — exibida no Layout Builder. */
  description: string;
  /** Categoria — agrupa modulos no Builder. */
  category: "core" | "growth" | "analytics" | "config";
  /** Pode ser desabilitado pelo admin? Inbox NAO (default obrigatorio). */
  required?: boolean;
}

export const MOBILE_MODULES: MobileModuleDescriptor[] = [
  {
    id: "inbox",
    label: "Inbox",
    href: "/inbox",
    iconName: "MessageSquare",
    description: "Conversas WhatsApp, e-mail e redes",
    category: "core",
    required: true,
  },
  {
    id: "pipeline",
    label: "Pipeline",
    href: "/pipeline",
    iconName: "Kanban",
    description: "Funil de vendas (Kanban)",
    category: "core",
  },
  {
    id: "tasks",
    label: "Tarefas",
    href: "/tasks",
    iconName: "CheckSquare",
    description: "Atividades atribuidas ao agente",
    category: "core",
  },
  {
    id: "contacts",
    label: "Contatos",
    href: "/contacts",
    iconName: "Users",
    description: "Base de contatos e leads",
    category: "core",
  },
  {
    id: "companies",
    label: "Empresas",
    href: "/companies",
    iconName: "Building2",
    description: "Empresas vinculadas",
    category: "core",
  },
  {
    id: "campaigns",
    label: "Campanhas",
    href: "/campaigns",
    iconName: "Megaphone",
    description: "Disparo em massa via templates",
    category: "growth",
  },
  {
    id: "automations",
    label: "Automações",
    href: "/automations",
    iconName: "Zap",
    description: "Salesbot, fluxos e gatilhos",
    category: "growth",
  },
  {
    id: "reports",
    label: "Relatórios",
    href: "/reports",
    iconName: "BarChart3",
    description: "Mensagens, conversões e equipe",
    category: "analytics",
  },
  {
    // O antigo /monitor foi absorvido pelo dashboard principal como
    // preset + TV Wall. Mantemos o id no union pra não quebrar o tipo
    // de preferências antigas gravadas no banco, mas redirecionamos
    // pra home com o preset apropriado.
    id: "monitor",
    label: "Monitor",
    href: "/?preset=monitor",
    iconName: "Activity",
    description: "Dashboard em modo supervisão em tempo real",
    category: "analytics",
  },
  {
    id: "settings",
    label: "Configurações",
    href: "/settings",
    iconName: "Settings",
    description: "Canais, equipe, templates",
    category: "config",
  },
  {
    id: "profile",
    label: "Meu perfil",
    href: "/settings/profile",
    iconName: "UserCircle2",
    description: "Conta do operador",
    category: "config",
  },
];

export const MOBILE_MODULE_IDS = MOBILE_MODULES.map((m) => m.id) as MobileModuleId[];

export const DEFAULT_BOTTOM_NAV: MobileModuleId[] = [
  "inbox",
  "pipeline",
  "tasks",
  "contacts",
];

export const DEFAULT_ENABLED: MobileModuleId[] = [
  "inbox",
  "pipeline",
  "tasks",
  "contacts",
  "companies",
  "settings",
  "profile",
];

/** Limite de itens visiveis no bottom nav (acima vira "Mais"). */
export const BOTTOM_NAV_MAX = 4;

export interface MobileLayoutConfigDto {
  bottomNav: MobileModuleId[];
  enabled: MobileModuleId[];
  startRoute: string;
  brandColor: string | null;
  version: number;
}

/**
 * Sanitiza um array de IDs:
 *  - Remove duplicatas.
 *  - Remove IDs invalidos (nao existem no catalogo).
 *  - Garante que modulos `required: true` estao presentes.
 *  - Trunca pra `maxItems` se especificado.
 */
export function sanitizeModuleIds(
  raw: string | string[] | null | undefined,
  options: { ensureRequired?: boolean; maxItems?: number } = {},
): MobileModuleId[] {
  const arr = Array.isArray(raw)
    ? raw
    : (raw ?? "").split(",").map((s) => s.trim());

  const valid = arr.filter((id): id is MobileModuleId =>
    MOBILE_MODULE_IDS.includes(id as MobileModuleId),
  );
  const seen = new Set<MobileModuleId>();
  const dedup: MobileModuleId[] = [];
  for (const id of valid) {
    if (seen.has(id)) continue;
    seen.add(id);
    dedup.push(id);
  }

  if (options.ensureRequired) {
    for (const m of MOBILE_MODULES) {
      if (m.required && !seen.has(m.id)) {
        dedup.unshift(m.id);
        seen.add(m.id);
      }
    }
  }

  if (options.maxItems && dedup.length > options.maxItems) {
    return dedup.slice(0, options.maxItems);
  }
  return dedup;
}

export function serializeModuleIds(ids: MobileModuleId[]): string {
  return ids.join(",");
}
