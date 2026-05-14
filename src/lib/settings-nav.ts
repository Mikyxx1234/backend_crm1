import {
  Bell,
  Bot,
  Clock,
  Database,
  FileText,
  Headphones,
  Key,
  Kanban,
  LayoutList,
  LifeBuoy,
  MessageCircle,
  MessageSquare,
  Package,
  Plug,
  Radio,
  Settings2,
  Shield,
  Shuffle,
  Smartphone,
  Sparkles,
  Tag,
  ThumbsDown,
  Upload,
  Users,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";
import { UserRole } from "@prisma/client";

/**
 * Fonte unica de verdade do menu de Configuracoes.
 *
 * A estrutura eh declarativa, hierarquica e orientada ao modelo mental
 * do usuario: itens similares agrupados por INTENCAO, nao por feature
 * tecnica. Inspiracao: Kommo / Intercom / Front.
 *
 * Cada item declara `allowedRoles` — roles que enxergam o item na
 * sidebar. Ausente = todos os roles. Isso eh o "ponto de extensao":
 * quando adicionar uma tabela de permissoes granulares no banco (como
 * o painel de Direitos do Kommo), basta substituir esse array por um
 * override vindo do backend. Enquanto isso, defaults baked-in
 * cobrem 95% dos casos com zero config.
 *
 * Convencoes:
 *  - Um item com `href=null` eh placeholder (nao navegavel). Use so
 *    pra secoes em desenvolvimento — preferir OMITIR o item a colocar
 *    um "em breve" que gera ruido visual.
 *  - `description` eh curta (<=40 chars), aparece embaixo do label em
 *    viewports largos.
 *  - `eyebrow` (opcional) marca itens com badge pequeno no canto
 *    (ex.: "Beta", "Novo"). Nao coloque dados dinamicos aqui.
 */

export type SettingsNavIcon = ComponentType<{ className?: string }>;

export type SettingsNavItem = {
  id: string;
  label: string;
  description?: string;
  icon: SettingsNavIcon;
  href: string | null;
  /**
   * Roles que enxergam o item. Ausente/undefined = visivel pra todos
   * os roles autenticados. Super-admin sempre enxerga tudo.
   */
  allowedRoles?: UserRole[];
  /** Permission key canônica (`resource:action`) para exibir o item. */
  requiredPermission?: string;
  /** Badge discreto no canto do item. Ex.: "Beta", "Novo". */
  eyebrow?: string;
};

export type SettingsNavGroup = {
  id: string;
  label: string;
  /** Icone do grupo — pintado no header da secao. */
  icon: SettingsNavIcon;
  /**
   * Breve descricao do agrupamento (opcional). Aparece embaixo do
   * titulo do grupo em mobile e como tooltip no desktop.
   */
  description?: string;
  items: SettingsNavItem[];
};

/** Lista dos roles padrao de gestao (admin + manager). */
const GESTAO: UserRole[] = [UserRole.ADMIN, UserRole.MANAGER];

/** Apenas admin da organizacao. */
const SO_ADMIN: UserRole[] = [UserRole.ADMIN];

export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    id: "comunicacao",
    label: "Comunicação",
    icon: MessageSquare,
    description: "Canais, templates e avisos",
    items: [
      {
        id: "channels",
        label: "Canais",
        description: "WhatsApp, Instagram, e-mail e webchat",
        icon: Radio,
        href: "/settings/channels",
        allowedRoles: GESTAO,
        requiredPermission: "settings:channels",
      },
      {
        id: "message-models",
        label: "Modelos de mensagem",
        description: "Internos, WhatsApp WABA e Flows (Kommo)",
        icon: LayoutList,
        href: "/settings/message-models",
        allowedRoles: GESTAO,
      },
      {
        id: "quick-replies",
        label: "Respostas rápidas",
        description: "Atalhos de texto do atendimento",
        icon: Zap,
        href: "/settings/quick-replies",
        requiredPermission: "template:view",
      },
      {
        id: "notifications",
        label: "Notificações",
        description: "Push, e-mail e alertas por canal",
        icon: Bell,
        href: "/settings/notifications",
        requiredPermission: "settings:webhooks",
      },
    ],
  },

  {
    id: "crm-dados",
    label: "CRM & Dados",
    icon: Database,
    description: "Campos, tags e importacao",
    items: [
      {
        id: "custom-fields",
        label: "Campos personalizados",
        description: "Contatos, empresas e negócios",
        icon: LayoutList,
        href: "/settings/custom-fields",
        allowedRoles: GESTAO,
        requiredPermission: "settings:custom_fields",
      },
      {
        id: "tags",
        label: "Tags",
        description: "Rotulos e cores",
        icon: Tag,
        href: "/settings/tags",
        allowedRoles: GESTAO,
        requiredPermission: "tag:view",
      },
      {
        id: "products",
        label: "Produtos",
        description: "Catalogo usado em negocios",
        icon: Package,
        href: "/settings/products",
        allowedRoles: GESTAO,
        requiredPermission: "product:view",
      },
      {
        id: "import",
        label: "Importar base",
        description: "CSV de contatos e negocios",
        icon: Upload,
        href: "/settings/import",
        allowedRoles: GESTAO,
        requiredPermission: "contact:import",
      },
    ],
  },

  {
    id: "vendas",
    label: "Vendas & Pipeline",
    icon: Kanban,
    description: "Funis, regras e distribuicao",
    items: [
      {
        id: "pipeline",
        label: "Pipeline",
        description: "Estagios e regras de movimentacao",
        icon: Kanban,
        href: "/settings/pipeline",
        allowedRoles: GESTAO,
        requiredPermission: "pipeline:view",
      },
      {
        id: "loss-reasons",
        label: "Motivos de perda",
        description: "Razoes padrao ao marcar perdido",
        icon: ThumbsDown,
        href: "/settings/loss-reasons",
        allowedRoles: GESTAO,
        requiredPermission: "deal:edit",
      },
      {
        id: "distribution",
        label: "Distribuição",
        description: "Round-robin, priorizacao e regras",
        icon: Shuffle,
        href: "/settings/distribution",
        allowedRoles: GESTAO,
        requiredPermission: "conversation:reassign_others",
      },
    ],
  },

  {
    id: "equipe-operacao",
    label: "Equipe & Operação",
    icon: Headphones,
    description: "Pessoas e expediente",
    items: [
      {
        id: "team",
        label: "Equipe",
        description: "Membros, funcoes e convites",
        icon: Users,
        href: "/settings/team",
        allowedRoles: GESTAO,
        requiredPermission: "settings:team",
      },
      {
        id: "schedules",
        label: "Horários e disponibilidade",
        description: "Expediente e status dos agentes",
        icon: Clock,
        href: "/settings/schedules",
        allowedRoles: GESTAO,
        requiredPermission: "settings:team",
      },
    ],
  },

  {
    id: "automacoes-ia",
    label: "Automações & IA",
    icon: Sparkles,
    description: "Agentes e assistentes inteligentes",
    items: [
      {
        id: "ai",
        label: "IA & Agentes",
        description: "Chaves de provedores e assistentes",
        icon: Bot,
        href: "/settings/ai",
        allowedRoles: GESTAO,
        requiredPermission: "ai_agent:view",
      },
    ],
  },

  {
    id: "integracoes",
    label: "Integrações",
    icon: Plug,
    description: "APIs externas e tokens",
    items: [
      {
        id: "api-tokens",
        label: "API e Webhooks",
        description: "Tokens de integracao e eventos",
        icon: Key,
        href: "/settings/api-tokens",
        allowedRoles: SO_ADMIN,
        requiredPermission: "settings:api_tokens",
      },
    ],
  },

  {
    id: "sistema",
    label: "Sistema",
    icon: Settings2,
    description: "Preferencias e acessos",
    items: [
      {
        id: "permissions",
        label: "Permissões",
        description: "Visibilidade de leads por funcao",
        icon: Shield,
        href: "/settings/permissions",
        allowedRoles: SO_ADMIN,
        requiredPermission: "settings:permissions",
      },
      {
        id: "mobile-layout",
        label: "App Mobile",
        description: "Barra inferior do PWA",
        icon: Smartphone,
        href: "/settings/mobile-layout",
        allowedRoles: GESTAO,
        requiredPermission: "settings:branding",
      },
    ],
  },
];

/**
 * Atalhos no topo do settings — acessos pessoais que todo usuario tem,
 * independente do role. Separados dos grupos principais pra nao poluir
 * a listagem de configuracoes do workspace.
 */
export const SETTINGS_PERSONAL: SettingsNavItem[] = [
  {
    id: "profile",
    label: "Meu perfil",
    description: "Nome, avatar, senha",
    icon: Users,
    href: "/settings/profile",
  },
  {
    id: "help",
    label: "Suporte",
    description: "Fale com o time EduIT",
    icon: LifeBuoy,
    href: "mailto:suporte@eduit.com.br",
  },
];
