export type FieldItem = {
  id: string;
  label: string;
  fixed?: boolean;
  hidden?: boolean;
};

/**
 * Discriminador opcional de seção:
 *   - undefined  → seção estática (blocos fixos do painel, comportamento legado).
 *   - "custom_fields_group" → subgrupo de campos personalizados (PRD
 *     Agrupamento de Campos na Aside). `entity` obrigatório neste caso.
 *     Cada `fields[i].id` referencia um `CustomField.id` real. Grupos
 *     órfãos (0 fields visíveis) não renderizam. Fallback (nenhum grupo
 *     configurado) mantém a lista flat atual — retrocompat (RN-05).
 */
export type SectionKind = "custom_fields_group";

export type SectionConfig = {
  id: string;
  label: string;
  fixed?: boolean;
  hidden?: boolean;
  fields: FieldItem[];
  kind?: SectionKind;
  entity?: "contact" | "deal";
  /** Estado inicial de colapso do grupo. Usuário pode ter override no layout dele. */
  collapsedDefault?: boolean;
};

/**
 * Definição mínima de um CustomField para resolver grupos. Vem do
 * `custom_fields` — apenas o que a aside precisa. Definido aqui para
 * evitar acoplamento com o client Prisma no frontend (o tipo é
 * compartilhado por serialização JSON).
 */
export type CustomFieldDef = {
  id: string;
  name: string;
  label: string;
  type: string;
  options?: string[];
  required?: boolean;
};

export type ResolvedCustomFieldGroup = {
  /** Null = bucket virtual "Outros campos" (nunca persistido). */
  group: {
    id: string;
    label: string;
    collapsedDefault: boolean;
  } | null;
  fields: CustomFieldDef[];
};

/**
 * Resolve os grupos de campos personalizados a partir do layout (já
 * mergeado admin→user) + as definições reais de custom fields da org.
 *
 * Regras:
 *   - Só considera seções com `kind === "custom_fields_group"` e `entity`
 *     igual ao da chamada. As demais seções são ignoradas aqui — quem
 *     renderiza os blocos fixos é o próprio painel.
 *   - Cada `fields[i].id` da seção deve corresponder a um `CustomField.id`
 *     existente. IDs desconhecidos são silenciosamente descartados
 *     (RN-02/CA-07: tolera campo excluído).
 *   - Campos ocultos pelo user (fields[i].hidden) não entram no bucket.
 *   - Seção com `hidden === true` é omitida por inteiro.
 *   - Se NENHUM grupo estiver configurado para a entidade → retorna um
 *     único bucket virtual (`group: null`) com TODOS os campos da org
 *     naquela entidade, na ordem original (RN-05/CA-01: retrocompat).
 *   - Se houver grupos mas sobrarem campos não vinculados → adiciona
 *     bucket virtual "Outros campos" ao final (RN-03/CA-03).
 */
export function resolveCustomFieldGroups(
  sections: SectionConfig[],
  allCustomFields: CustomFieldDef[],
  entity: "contact" | "deal",
): ResolvedCustomFieldGroup[] {
  const byId = new Map(allCustomFields.map((f) => [f.id, f] as const));
  const groups = sections.filter(
    (s) => s.kind === "custom_fields_group" && s.entity === entity && !s.hidden,
  );

  // RN-05: sem grupos configurados → devolve tudo em bucket virtual.
  if (groups.length === 0) {
    return allCustomFields.length === 0
      ? []
      : [{ group: null, fields: allCustomFields }];
  }

  const used = new Set<string>();
  const resolved: ResolvedCustomFieldGroup[] = [];
  for (const s of groups) {
    const fields: CustomFieldDef[] = [];
    for (const item of s.fields) {
      const def = byId.get(item.id);
      if (!def) continue;
      // Field está atribuído a este grupo, portanto não é órfão — mesmo
      // que o usuário tenha escondido explicitamente (hidden=true).
      used.add(def.id);
      if (item.hidden) continue;
      fields.push(def);
    }
    // Grupo sem campos visíveis não renderiza (CA por consequência).
    if (fields.length === 0) continue;
    resolved.push({
      group: {
        id: s.id,
        label: s.label,
        collapsedDefault: Boolean(s.collapsedDefault),
      },
      fields,
    });
  }

  const orphans = allCustomFields.filter((f) => !used.has(f.id));
  if (orphans.length > 0) {
    resolved.push({ group: null, fields: orphans });
  }
  return resolved;
}

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
        // Override do usuário sobre o estado inicial de colapso do grupo
        // (custom_fields_group). Para seções normais, `collapsedDefault`
        // vem undefined e é ignorado.
        collapsedDefault:
          adminSection.kind === "custom_fields_group" &&
          agentSection.collapsedDefault !== undefined
            ? agentSection.collapsedDefault
            : adminSection.collapsedDefault,
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
