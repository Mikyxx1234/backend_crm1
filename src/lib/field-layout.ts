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

export const DEFAULTS: Record<string, SectionConfig[]> = {
  deal_workspace: DEFAULT_SECTIONS_DEAL_WORKSPACE,
  inbox_crm: DEFAULT_SECTIONS_INBOX_CRM,
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
