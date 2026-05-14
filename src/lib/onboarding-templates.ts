import type { CustomFieldType } from "@prisma/client";

/**
 * Templates de pipeline oferecidos no passo 4 do onboarding. Cada preset
 * cria um Pipeline com stages coerentes + conjunto minimo de CustomFields,
 * LossReasons e QuickReplies pro time operar no dia 1.
 *
 * Ao adicionar um novo template, mantenha:
 *   - Ao menos 1 stage com isIncoming=true (entrada do funil).
 *   - Positions sequenciais (0..N), unicas por pipeline (enforce do schema).
 *   - CustomFields com type valido (ver enum CustomFieldType do prisma).
 *
 * O template e aplicado pelo endpoint POST /api/onboarding/pipeline dentro
 * de uma transacao — se qualquer insert falhar, tudo e revertido.
 */

export type PipelineTemplateId = "educational" | "saas" | "generic";

export type StageTemplate = {
  name: string;
  position: number;
  color: string;
  winProbability: number;
  rottingDays: number;
  isIncoming?: boolean;
};

export type CustomFieldTemplate = {
  name: string;
  label: string;
  type: CustomFieldType;
  options?: string[];
  required?: boolean;
  /** contact | deal | product */
  entity: "contact" | "deal" | "product";
  showInInboxLeadPanel?: boolean;
  inboxLeadPanelOrder?: number;
};

export type QuickReplyTemplate = {
  title: string;
  content: string;
  category?: string;
  position: number;
};

export type PipelineTemplate = {
  id: PipelineTemplateId;
  label: string;
  description: string;
  pipelineName: string;
  stages: StageTemplate[];
  lossReasons: { label: string; position: number }[];
  customFields: CustomFieldTemplate[];
  quickReplies: QuickReplyTemplate[];
};

export const PIPELINE_TEMPLATES: Record<PipelineTemplateId, PipelineTemplate> = {
  educational: {
    id: "educational",
    label: "Educacional",
    description:
      "Ideal pra escolas, cursos e instituições de ensino. Captura interesse, agenda visita e fecha matrícula.",
    pipelineName: "Matrícula",
    stages: [
      { name: "Interesse", position: 0, color: "#60a5fa", winProbability: 10, rottingDays: 14, isIncoming: true },
      { name: "Qualificação", position: 1, color: "#818cf8", winProbability: 25, rottingDays: 10 },
      { name: "Visita agendada", position: 2, color: "#a78bfa", winProbability: 50, rottingDays: 7 },
      { name: "Proposta enviada", position: 3, color: "#f59e0b", winProbability: 70, rottingDays: 7 },
      { name: "Matrícula", position: 4, color: "#10b981", winProbability: 100, rottingDays: 30 },
    ],
    lossReasons: [
      { label: "Não tem interesse no momento", position: 0 },
      { label: "Concorrente fechou antes", position: 1 },
      { label: "Valor acima do orçamento", position: 2 },
      { label: "Mudou de cidade", position: 3 },
      { label: "Lead frio / não responde", position: 4 },
    ],
    customFields: [
      {
        name: "serie_interesse",
        label: "Série de interesse",
        type: "TEXT",
        entity: "contact",
        showInInboxLeadPanel: true,
        inboxLeadPanelOrder: 1,
      },
      {
        name: "responsavel",
        label: "Nome do responsável",
        type: "TEXT",
        entity: "contact",
        showInInboxLeadPanel: true,
        inboxLeadPanelOrder: 2,
      },
      {
        name: "origem_lead",
        label: "Origem do lead",
        type: "SELECT",
        options: ["Indicação", "Google", "Instagram", "Facebook", "Site", "Outdoor"],
        entity: "contact",
      },
      {
        name: "ano_letivo",
        label: "Ano letivo",
        type: "TEXT",
        entity: "deal",
      },
    ],
    quickReplies: [
      { title: "Boas-vindas", content: "Olá! Tudo bem? Aqui é da {{org}}. Em que posso ajudar?", position: 0, category: "Atendimento" },
      { title: "Solicitar nome", content: "Pra personalizar o atendimento, qual seu nome e o do aluno(a)?", position: 1, category: "Qualificação" },
      { title: "Agendar visita", content: "Quando seria melhor pra uma visita guiada? Temos horários de manhã e tarde.", position: 2, category: "Agendamento" },
      { title: "Envio de proposta", content: "Segue em anexo nossa proposta com valores e condições. Fico à disposição pra tirar dúvidas!", position: 3, category: "Proposta" },
      { title: "Follow-up", content: "Oi! Passando pra saber se conseguiu analisar a proposta.", position: 4, category: "Follow-up" },
    ],
  },
  saas: {
    id: "saas",
    label: "SaaS / B2B",
    description:
      "Pra produtos digitais com trial e ciclo de venda médio. Do MQL à assinatura paga.",
    pipelineName: "Vendas SaaS",
    stages: [
      { name: "MQL (Marketing)", position: 0, color: "#60a5fa", winProbability: 10, rottingDays: 14, isIncoming: true },
      { name: "SQL (Qualificado)", position: 1, color: "#818cf8", winProbability: 20, rottingDays: 10 },
      { name: "Demo agendada", position: 2, color: "#a78bfa", winProbability: 40, rottingDays: 7 },
      { name: "Trial ativo", position: 3, color: "#ec4899", winProbability: 60, rottingDays: 14 },
      { name: "Negociação", position: 4, color: "#f59e0b", winProbability: 80, rottingDays: 7 },
      { name: "Fechado", position: 5, color: "#10b981", winProbability: 100, rottingDays: 30 },
    ],
    lossReasons: [
      { label: "Sem budget", position: 0 },
      { label: "Escolheu concorrente", position: 1 },
      { label: "Falta funcionalidade crítica", position: 2 },
      { label: "Timing ruim (voltar em N meses)", position: 3 },
      { label: "Lead desqualificado", position: 4 },
    ],
    customFields: [
      {
        name: "empresa",
        label: "Empresa",
        type: "TEXT",
        entity: "contact",
        showInInboxLeadPanel: true,
        inboxLeadPanelOrder: 1,
      },
      {
        name: "cargo",
        label: "Cargo / Função",
        type: "TEXT",
        entity: "contact",
        showInInboxLeadPanel: true,
        inboxLeadPanelOrder: 2,
      },
      {
        name: "tamanho_empresa",
        label: "Tamanho da empresa",
        type: "SELECT",
        options: ["1-10", "11-50", "51-200", "201-500", "500+"],
        entity: "contact",
      },
      {
        name: "mrr",
        label: "MRR (R$/mês)",
        type: "NUMBER",
        entity: "deal",
      },
      {
        name: "plano",
        label: "Plano",
        type: "SELECT",
        options: ["Starter", "Growth", "Pro", "Enterprise"],
        entity: "deal",
      },
    ],
    quickReplies: [
      { title: "Boas-vindas", content: "Olá! Vi que você demonstrou interesse na {{org}}. Posso te ajudar a entender como funciona?", position: 0, category: "Atendimento" },
      { title: "Agendar demo", content: "Que tal agendar uma demo de 20 minutos pra te mostrar na prática? Tenho horários nessa semana.", position: 1, category: "Agendamento" },
      { title: "Link do trial", content: "Aqui está o link pra ativar seu trial grátis por 14 dias: {{link}}", position: 2, category: "Trial" },
      { title: "Follow-up trial", content: "Oi! Como está sendo sua experiência com o trial? Conseguiu testar os recursos principais?", position: 3, category: "Follow-up" },
      { title: "Proposta", content: "Anexei nossa proposta com o plano que melhor se encaixa. Qualquer dúvida, estou aqui!", position: 4, category: "Proposta" },
    ],
  },
  generic: {
    id: "generic",
    label: "Genérico",
    description:
      "Pipeline enxuta que serve pra qualquer negócio. Edite depois no painel de configurações.",
    pipelineName: "Pipeline principal",
    stages: [
      { name: "Novo", position: 0, color: "#60a5fa", winProbability: 10, rottingDays: 14, isIncoming: true },
      { name: "Contato feito", position: 1, color: "#818cf8", winProbability: 25, rottingDays: 10 },
      { name: "Qualificado", position: 2, color: "#a78bfa", winProbability: 50, rottingDays: 10 },
      { name: "Proposta", position: 3, color: "#f59e0b", winProbability: 70, rottingDays: 7 },
      { name: "Ganho", position: 4, color: "#10b981", winProbability: 100, rottingDays: 30 },
    ],
    lossReasons: [
      { label: "Sem interesse", position: 0 },
      { label: "Preço", position: 1 },
      { label: "Concorrente", position: 2 },
      { label: "Não responde", position: 3 },
    ],
    customFields: [
      {
        name: "origem",
        label: "Origem",
        type: "TEXT",
        entity: "contact",
      },
    ],
    quickReplies: [
      { title: "Boas-vindas", content: "Olá! Recebemos seu contato. Como posso ajudar?", position: 0 },
      { title: "Follow-up", content: "Oi, tudo bem? Passando pra retomar nossa conversa.", position: 1 },
      { title: "Agradecimento", content: "Obrigado pelo contato! Em breve te respondo.", position: 2 },
    ],
  },
};

export const PIPELINE_TEMPLATE_LIST: PipelineTemplate[] = [
  PIPELINE_TEMPLATES.educational,
  PIPELINE_TEMPLATES.saas,
  PIPELINE_TEMPLATES.generic,
];
