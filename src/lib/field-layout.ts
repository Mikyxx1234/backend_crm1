export type FieldItem = {
  id: string;
  label: string;
  fixed?: boolean;
  hidden?: boolean;
};

export type SectionConfig = {
  id: string;
  label: string;
  fixed?: boolean;
  hidden?: boolean;
  fields: FieldItem[];
};

export const DEFAULT_SECTIONS_DEAL_WORKSPACE: SectionConfig[] = [
  {
    id: "negocio",
    label: "Negócio",
    fixed: true,
    fields: [
      { id: "stage", label: "Estágio", fixed: true },
      { id: "owner", label: "Responsável", fixed: true },
      { id: "origin", label: "Origem" },
      { id: "expected_close", label: "Previsão" },
      { id: "tags", label: "Tags" },
    ],
  },
  {
    id: "produtos",
    label: "Produtos",
    fields: [{ id: "products_list", label: "Lista de produtos" }],
  },
  {
    id: "contato",
    label: "Contato",
    fields: [
      { id: "phone", label: "Telefone" },
      { id: "email", label: "E-mail" },
      { id: "company", label: "Empresa" },
    ],
  },
  {
    id: "campos_deal",
    label: "Campos do negócio",
    fields: [{ id: "custom_deal_fields", label: "Campos personalizados" }],
  },
  {
    id: "campos_contato",
    label: "Campos do contato",
    fields: [{ id: "custom_contact_fields", label: "Campos personalizados" }],
  },
];

export const DEFAULT_SECTIONS_INBOX_CRM: SectionConfig[] = [
  {
    id: "negocio",
    label: "Negócio",
    fixed: true,
    fields: [
      { id: "deal_title", label: "Negócio ativo", fixed: true },
      { id: "stage", label: "Estágio" },
      { id: "owner", label: "Responsável" },
    ],
  },
  {
    id: "contato",
    label: "Contato",
    fields: [
      { id: "phone", label: "Telefone" },
      { id: "email", label: "E-mail" },
      { id: "lifecycle", label: "Fase" },
      { id: "engagement", label: "Engajamento" },
    ],
  },
  {
    id: "campos_contato",
    label: "Campos do contato",
    fields: [{ id: "custom_contact_fields", label: "Campos personalizados" }],
  },
  {
    id: "todos_negocios",
    label: "Todos os negócios",
    fields: [{ id: "deals_list", label: "Lista de negócios" }],
  },
];

// ── Painéis v2 (glassmorphism) ───────────────────────────────────────
// Taxonomia de blocos das barras novas: contact-aside (inbox_lead_v2) e
// deal-detail-panel (deal_panel_v2). Reusa a mesma estrutura SectionConfig
// e a rota /api/field-layout genérica — só muda o `context`.

export const DEFAULT_SECTIONS_INBOX_LEAD_V2: SectionConfig[] = [
  {
    id: "header",
    label: "Cabeçalho (nome + ID)",
    fixed: true,
    fields: [],
  },
  {
    id: "responsavel",
    label: "Responsável",
    fields: [{ id: "owner", label: "Responsável" }],
  },
  {
    id: "tags",
    label: "Tags",
    fields: [{ id: "tags", label: "Tags" }],
  },
  {
    id: "status",
    label: "Status",
    fields: [{ id: "status_badge", label: "Status" }],
  },
  {
    id: "nota",
    label: "Nota",
    fields: [{ id: "note", label: "Nota" }],
  },
  {
    id: "detalhes_contato",
    label: "Detalhes de contato",
    fields: [
      { id: "name", label: "Nome", fixed: true },
      { id: "phone", label: "Telefone" },
      { id: "email", label: "E-mail" },
      { id: "cpf", label: "CPF" },
      { id: "rg", label: "RG" },
      { id: "cep", label: "CEP" },
      { id: "address_number", label: "Nº residência" },
      { id: "birth_date", label: "Data de nascimento" },
    ],
  },
  {
    id: "campos_personalizados",
    label: "Campos personalizados",
    fields: [{ id: "custom_panel_fields", label: "Campos personalizados" }],
  },
  {
    id: "negocios",
    label: "Negócios vinculados",
    fields: [{ id: "deals_list", label: "Cards de negócios" }],
  },
];

export const DEFAULT_SECTIONS_DEAL_PANEL_V2: SectionConfig[] = [
  {
    id: "funil",
    label: "Funil de vendas",
    fixed: true,
    fields: [],
  },
  {
    id: "principal",
    label: "Principal",
    fields: [
      { id: "owner", label: "Responsável" },
      { id: "value", label: "Venda" },
      { id: "origin", label: "Origem" },
      { id: "forecast", label: "Previsão" },
      { id: "tags", label: "Tags" },
    ],
  },
  {
    id: "dados_contato",
    label: "Dados de contato",
    fields: [
      { id: "phone", label: "Telefone" },
      { id: "email", label: "E-mail" },
    ],
  },
  {
    id: "campos_negocio",
    label: "Campos do negócio",
    fields: [{ id: "custom_deal_fields", label: "Campos personalizados" }],
  },
];

export const DEFAULTS: Record<string, SectionConfig[]> = {
  deal_workspace: DEFAULT_SECTIONS_DEAL_WORKSPACE,
  inbox_crm: DEFAULT_SECTIONS_INBOX_CRM,
  inbox_lead_v2: DEFAULT_SECTIONS_INBOX_LEAD_V2,
  deal_panel_v2: DEFAULT_SECTIONS_DEAL_PANEL_V2,
};

// Merge: padrão do admin como base, override do agente por cima
// Seções e campos fixed do admin nunca são afetados pelo agente
export function mergeLayouts(
  adminSections: SectionConfig[],
  agentSections: SectionConfig[] | null,
): SectionConfig[] {
  if (!agentSections || agentSections.length === 0) return adminSections;
  return agentSections
    .map((agentSection) => {
      const adminSection = adminSections.find((s) => s.id === agentSection.id);
      if (!adminSection) return null;
      if (adminSection.fixed) return adminSection;
      return {
        ...adminSection,
        hidden: agentSection.hidden,
        fields: agentSection.fields
          .map((af) => {
            const adminField = adminSection.fields.find((f) => f.id === af.id);
            if (!adminField) return null;
            if (adminField.fixed) return adminField;
            return { ...adminField, hidden: af.hidden };
          })
          .filter(Boolean) as FieldItem[],
      };
    })
    .filter(Boolean) as SectionConfig[];
}
