/**
 * Catalogo estatico de widgets (extensoes internas) da Central de Widgets.
 *
 * Fonte unica da verdade para a DEFINICAO de cada widget: slug, nome,
 * descricao, features, icone e categoria. O banco (`OrganizationWidget`)
 * guarda apenas o ESTADO de instalacao por organizacao — nunca a definicao.
 *
 * Para adicionar um widget novo: inclua um item em `AVAILABLE_WIDGETS`.
 * O `slug` precisa ser unico e estavel (e gravado no banco). O `icon` e
 * uma string mapeada para um componente no frontend
 * (`src/app/(app)/widgets/_components/widget-card.tsx`).
 */

/** Status de disponibilidade do widget no catalogo (nao confundir com o
 *  status de instalacao por org, que e ACTIVE/INACTIVE no banco). */
export type WidgetAvailability = "available" | "coming_soon";

export interface WidgetDefinition {
  /** Identificador interno, snake_case. Gravado em OrganizationWidget.widgetSlug. */
  slug: string;
  /** Nome exibido no card. */
  name: string;
  /** Descricao curta exibida no card. */
  description: string;
  /** Lista curta de features mostradas no card. */
  features: string[];
  /** Chave de icone resolvida no frontend (ex.: "route", "bot"). */
  icon: string;
  /** Categoria/grupo do widget. */
  category: string;
  /** Disponibilidade no catalogo. "coming_soon" nao pode ser instalado. */
  availability: WidgetAvailability;
}

export const AVAILABLE_WIDGETS: readonly WidgetDefinition[] = [
  {
    slug: "smart_distribution",
    name: "Distribuição Inteligente",
    description:
      "Automatize a distribuição de leads entre consultores usando regras inteligentes, disponibilidade, fila, prioridade e equilíbrio operacional.",
    features: [
      "Distribuição automática de leads",
      "Regras por consultor, fila ou time",
      "Priorização inteligente",
      "Equilíbrio operacional",
    ],
    icon: "route",
    category: "Operação Comercial",
    availability: "available",
  },
  {
    slug: "ai_agents",
    name: "Agentes de IA",
    description:
      "Configure agentes de IA para atendimento, qualificação, recomendação de cursos, reativação de leads e automações conversacionais dentro do CRM.",
    features: [
      "Agentes de atendimento",
      "Qualificação automática",
      "Respostas inteligentes",
      "Integração com fluxos e automações",
    ],
    icon: "bot",
    category: "Inteligência Artificial",
    availability: "available",
  },
] as const;

/** Set de slugs validos (whitelist). Use para validar input do cliente. */
export const WIDGET_SLUGS: ReadonlySet<string> = new Set(
  AVAILABLE_WIDGETS.map((w) => w.slug),
);

/** Retorna a definicao de um widget pelo slug, ou `undefined` se invalido. */
export function getWidgetBySlug(slug: string): WidgetDefinition | undefined {
  return AVAILABLE_WIDGETS.find((w) => w.slug === slug);
}

/** True se o slug existe no catalogo E esta disponivel para instalacao. */
export function isInstallableSlug(slug: string): boolean {
  const w = getWidgetBySlug(slug);
  return Boolean(w && w.availability === "available");
}
