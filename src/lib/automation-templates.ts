/**
 * Catálogo de automações pré-prontas — templates inspirados nos fluxos mais
 * usados do mercado (Kommo, RD Station, ActiveCampaign, HubSpot, PipeRun).
 *
 * Cada template é auto-contido: define `triggerType`, `triggerConfig`,
 * `steps` com IDs estáveis e configurações completas. Ao aplicar, o wizard
 * de nova automação pré-carrega todos os campos e salta direto para o
 * canvas, onde o operador ajusta IDs de pipeline/tag/estágio antes de
 * ativar.
 *
 * Convenções:
 *  - Placeholders `{{first_name}}`, `{{company}}`, etc. seguem o padrão
 *    do executor (resolvidos em runtime).
 *  - IDs de estágio/tag são deixados vazios propositalmente; o operador
 *    escolhe no UI antes de ativar.
 *  - Cada template tem `category`, `icon` e `popular` para UI.
 */

import type { LucideIcon } from "lucide-react";
import {
  AlarmClock,
  BadgeCheck,
  Cake,
  CalendarClock,
  ClipboardList,
  GraduationCap,
  HandCoins,
  Handshake,
  HeartHandshake,
  MessageSquareHeart,
  Repeat,
  Sparkles,
  Target,
  Users,
  Zap,
} from "lucide-react";

export type AutomationTemplateStep = {
  id: string;
  type: string;
  config: Record<string, unknown>;
};

export type AutomationTemplateCategory =
  | "leads"
  | "vendas"
  | "educacional"
  | "pos-venda"
  | "retencao"
  | "atendimento";

export type AutomationTemplate = {
  /** Slug estável — usado em analytics/logs. */
  id: string;
  name: string;
  /** Resumo curto (até ~120 caracteres) para o card. */
  tagline: string;
  /** Descrição longa — renderizada no detalhe. */
  description: string;
  category: AutomationTemplateCategory;
  icon: LucideIcon;
  /** Tonal hint para o card — mapeado na UI. */
  accent: "blue" | "emerald" | "amber" | "violet" | "rose" | "cyan" | "indigo" | "fuchsia";
  /** Destaque na galeria (badge "Mais usado"). */
  popular?: boolean;
  /** Pré-pronto para aplicar — false quando depende de bastante config manual. */
  ready: boolean;
  /** Tempo médio de setup estimado (min). */
  setupMinutes: number;
  /** Valores que serão pré-preenchidos no wizard. */
  automation: {
    name: string;
    description: string;
    triggerType: string;
    triggerConfig: Record<string, unknown>;
    steps: AutomationTemplateStep[];
  };
};

/**
 * Helper: gera IDs determinísticos no escopo do template (evita colisão no
 * canvas quando o operador combina múltiplos templates no mesmo editor).
 */
function sid(template: string, step: string): string {
  return `tpl_${template}_${step}`;
}

const T_WELCOME: AutomationTemplate = {
  id: "welcome-new-lead",
  name: "Boas-vindas ao novo lead",
  tagline: "Saudação imediata + qualificação inicial quando um contato entra no CRM.",
  description:
    "Assim que o contato é criado (import, formulário, WhatsApp), envia uma mensagem de boas-vindas, identifica o interesse em 3 opções e encaminha para o funil correto.",
  category: "leads",
  icon: Sparkles,
  accent: "blue",
  popular: true,
  ready: true,
  setupMinutes: 2,
  automation: {
    name: "Boas-vindas ao novo lead",
    description: "Saudação + qualificação inicial de novos contatos.",
    triggerType: "contact_created",
    triggerConfig: { markAsRead: true, simulateTyping: true },
    steps: [
      {
        id: sid("welcome", "1"),
        type: "send_whatsapp_message",
        config: {
          content:
            "Olá, {{first_name}}! 👋 Obrigado pelo interesse. Me diz em que posso te ajudar hoje:",
        },
      },
      {
        id: sid("welcome", "2"),
        type: "question",
        config: {
          message: "Escolhe uma das opções:",
          buttons: [
            { id: "btn-info", title: "Quero informações" },
            { id: "btn-preco", title: "Valores e planos" },
            { id: "btn-demo", title: "Agendar conversa" },
          ],
          saveToVariable: "interesse_inicial",
          timeoutMs: 86_400_000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: sid("welcome", "3"),
        type: "add_tag",
        config: { tagName: "Lead novo" },
      },
    ],
  },
};

const T_QUALIFY_BANT: AutomationTemplate = {
  id: "qualify-bant",
  name: "Qualificação BANT",
  tagline: "4 perguntas (Orçamento, Autoridade, Necessidade, Prazo) + lead score.",
  description:
    "Metodologia clássica B2B. Faz as 4 perguntas em sequência via botões, soma os pontos em uma variável e atribui score. Marca lead como quente/morno/frio automaticamente.",
  category: "leads",
  icon: Target,
  accent: "indigo",
  popular: true,
  ready: true,
  setupMinutes: 5,
  automation: {
    name: "Qualificação BANT",
    description: "Score automático por método BANT (Budget / Authority / Need / Timeline).",
    triggerType: "tag_added",
    triggerConfig: { tagName: "Qualificar" },
    steps: [
      {
        id: sid("bant", "1"),
        type: "question",
        config: {
          message: "Qual a faixa de investimento que você tem em mente?",
          buttons: [
            { id: "b1", title: "Até R$ 1 mil" },
            { id: "b2", title: "R$ 1 a 5 mil" },
            { id: "b3", title: "Acima de R$ 5 mil" },
          ],
          saveToVariable: "budget",
          timeoutMs: 86_400_000,
          timeoutAction: "stop",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: sid("bant", "2"),
        type: "question",
        config: {
          message: "Você é quem decide ou precisa envolver outras pessoas?",
          buttons: [
            { id: "a1", title: "Eu decido" },
            { id: "a2", title: "Decisão em grupo" },
          ],
          saveToVariable: "authority",
          timeoutMs: 86_400_000,
          timeoutAction: "stop",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: sid("bant", "3"),
        type: "question",
        config: {
          message: "Para quando você precisa resolver essa necessidade?",
          buttons: [
            { id: "t1", title: "Esta semana" },
            { id: "t2", title: "Este mês" },
            { id: "t3", title: "Sem pressa" },
          ],
          saveToVariable: "timeline",
          timeoutMs: 86_400_000,
          timeoutAction: "stop",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: sid("bant", "4"),
        type: "update_lead_score",
        config: {},
      },
      {
        id: sid("bant", "5"),
        type: "add_tag",
        config: { tagName: "BANT concluído" },
      },
    ],
  },
};

const T_MATRICULA: AutomationTemplate = {
  id: "matricula-educacional",
  name: "Jornada de matrícula (educacional)",
  tagline: "Captação → visita → matrícula. Fluxo completo de escola/curso.",
  description:
    "Sequência clássica do setor educacional: boas-vindas, pergunta sobre série/curso de interesse, oferta de visita presencial ou online, lembrete 1 dia antes e follow-up pós-visita.",
  category: "educacional",
  icon: GraduationCap,
  accent: "cyan",
  popular: true,
  ready: true,
  setupMinutes: 6,
  automation: {
    name: "Jornada de matrícula",
    description: "Fluxo completo de captação e matrícula para escolas e cursos.",
    triggerType: "contact_created",
    triggerConfig: { markAsRead: true, simulateTyping: true },
    steps: [
      {
        id: sid("matricula", "1"),
        type: "send_whatsapp_message",
        config: {
          content:
            "Olá, {{first_name}}! 🎓 Sou a secretaria da escola. Que bom ter você por aqui! Para te ajudar melhor, me conta: o interesse é para qual série ou curso?",
        },
      },
      {
        id: sid("matricula", "2"),
        type: "wait_for_reply",
        config: { timeoutMs: 86_400_000, receivedGotoStepId: "", timeoutGotoStepId: "" },
      },
      {
        id: sid("matricula", "3"),
        type: "question",
        config: {
          message: "Ótimo! Gostaria de conhecer a escola pessoalmente ou prefere uma conversa online primeiro?",
          buttons: [
            { id: "v1", title: "Visita presencial" },
            { id: "v2", title: "Conversa online" },
            { id: "v3", title: "Só quero info por enquanto" },
          ],
          saveToVariable: "preferencia_visita",
          timeoutMs: 172_800_000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: sid("matricula", "4"),
        type: "create_activity",
        config: {
          type: "TASK",
          title: "Agendar visita/conversa com {{first_name}}",
          description: "Lead qualificado pela automação de matrícula.",
        },
      },
      {
        id: sid("matricula", "5"),
        type: "add_tag",
        config: { tagName: "Matrícula em andamento" },
      },
    ],
  },
};

const T_STALLED_DEAL: AutomationTemplate = {
  id: "stalled-deal-recovery",
  name: "Recuperar negócio parado",
  tagline: "Follow-up automático quando um deal passa 3 dias no mesmo estágio.",
  description:
    "Evita negócios esquecidos no meio do funil. Após 3 dias parados, envia um follow-up pro contato e cria tarefa pro responsável checar o status.",
  category: "vendas",
  icon: AlarmClock,
  accent: "amber",
  popular: true,
  ready: false,
  setupMinutes: 3,
  automation: {
    name: "Recuperar negócio parado",
    description: "Follow-up para deals parados há 3+ dias no mesmo estágio.",
    triggerType: "stage_changed",
    triggerConfig: { fromStageId: "", toStageId: "" },
    steps: [
      {
        id: sid("stalled", "1"),
        type: "delay",
        config: { ms: 259_200_000 },
      },
      {
        id: sid("stalled", "2"),
        type: "send_whatsapp_message",
        config: {
          content:
            "Oi, {{first_name}}! Passando para saber se conseguiu revisar nossa conversa. Posso te ajudar com alguma dúvida?",
        },
      },
      {
        id: sid("stalled", "3"),
        type: "create_activity",
        config: {
          type: "TASK",
          title: "Checar status do negócio {{deal_title}}",
          description: "Deal sem movimentação há 3 dias — contatar cliente.",
        },
      },
      {
        id: sid("stalled", "4"),
        type: "add_tag",
        config: { tagName: "Follow-up ativo" },
      },
    ],
  },
};

const T_POST_DEMO: AutomationTemplate = {
  id: "nurture-post-demo",
  name: "Nutrição pós-demonstração",
  tagline: "3 mensagens em 2, 5 e 10 dias após a demo para manter o interesse.",
  description:
    "Sequência de aquecimento após a reunião de demonstração. Reforça valor, envia case de sucesso e faz a chamada final para fechamento.",
  category: "vendas",
  icon: MessageSquareHeart,
  accent: "violet",
  ready: false,
  setupMinutes: 4,
  automation: {
    name: "Nutrição pós-demonstração",
    description: "Sequência de 3 toques após a demo.",
    triggerType: "stage_changed",
    triggerConfig: { fromStageId: "", toStageId: "" },
    steps: [
      { id: sid("postdemo", "1"), type: "delay", config: { ms: 172_800_000 } },
      {
        id: sid("postdemo", "2"),
        type: "send_whatsapp_message",
        config: {
          content:
            "{{first_name}}, foi ótimo nossa conversa! Separei um material complementar que pode te ajudar a apresentar a proposta internamente. Te envio?",
        },
      },
      { id: sid("postdemo", "3"), type: "delay", config: { ms: 259_200_000 } },
      {
        id: sid("postdemo", "4"),
        type: "send_whatsapp_message",
        config: {
          content:
            "Quero compartilhar um case de um cliente com perfil parecido com o seu — os resultados podem te surpreender. Quer ver?",
        },
      },
      { id: sid("postdemo", "5"), type: "delay", config: { ms: 432_000_000 } },
      {
        id: sid("postdemo", "6"),
        type: "send_whatsapp_message",
        config: {
          content:
            "{{first_name}}, conseguiu avançar por aí? Estou disponível para tirar qualquer dúvida e fechar junto. 🤝",
        },
      },
    ],
  },
};

const T_WON_ONBOARDING: AutomationTemplate = {
  id: "won-onboarding",
  name: "Onboarding de cliente ganho",
  tagline: "Parabéns, tarefa de onboarding e NPS 7 dias depois.",
  description:
    "Celebra o fechamento, registra tarefa de onboarding pro sucesso do cliente e agenda pesquisa de NPS uma semana depois para capturar o momento de maior satisfação.",
  category: "pos-venda",
  icon: Handshake,
  accent: "emerald",
  popular: true,
  ready: false,
  setupMinutes: 3,
  automation: {
    name: "Onboarding pós-venda",
    description: "Agradecer, onboardar e coletar NPS após fechamento.",
    triggerType: "deal_won",
    triggerConfig: { pipelineId: "" },
    steps: [
      {
        id: sid("won", "1"),
        type: "send_whatsapp_message",
        config: {
          content:
            "🎉 {{first_name}}, seja muito bem-vindo(a)! Em breve você receberá o passo a passo do onboarding. Seguimos juntos!",
        },
      },
      {
        id: sid("won", "2"),
        type: "create_activity",
        config: {
          type: "TASK",
          title: "Iniciar onboarding de {{first_name}}",
          description: "Novo cliente — agendar kickoff nas próximas 48h.",
        },
      },
      {
        id: sid("won", "3"),
        type: "add_tag",
        config: { tagName: "Cliente ativo" },
      },
      { id: sid("won", "4"), type: "delay", config: { ms: 604_800_000 } },
      {
        id: sid("won", "5"),
        type: "question",
        config: {
          message:
            "Oi, {{first_name}}! Uma semana se passou. De 0 a 10, o quanto você recomendaria nosso trabalho para um colega?",
          buttons: [
            { id: "n0", title: "0-6" },
            { id: "n1", title: "7-8" },
            { id: "n2", title: "9-10" },
          ],
          saveToVariable: "nps_score",
          timeoutMs: 259_200_000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
    ],
  },
};

const T_LOST_FEEDBACK: AutomationTemplate = {
  id: "lost-feedback",
  name: "Feedback de negócio perdido",
  tagline: "Pergunta motivo da desistência e tagueia para remarketing.",
  description:
    "Transforma perda em inteligência. Pergunta o motivo da não-compra via botões, salva a resposta no contato e tagueia para uma campanha de reengajamento futura.",
  category: "vendas",
  icon: ClipboardList,
  accent: "rose",
  ready: false,
  setupMinutes: 2,
  automation: {
    name: "Feedback de negócio perdido",
    description: "Entender motivo da perda e marcar para remarketing.",
    triggerType: "deal_lost",
    triggerConfig: { pipelineId: "" },
    steps: [
      {
        id: sid("lost", "1"),
        type: "send_whatsapp_message",
        config: {
          content:
            "Oi, {{first_name}}. Obrigado pelo tempo dedicado a essa conversa. Se puder, queria entender rapidinho um ponto:",
        },
      },
      {
        id: sid("lost", "2"),
        type: "question",
        config: {
          message: "O que pesou mais na sua decisão?",
          buttons: [
            { id: "m1", title: "Preço" },
            { id: "m2", title: "Timing" },
            { id: "m3", title: "Outra solução" },
          ],
          saveToVariable: "motivo_perda",
          timeoutMs: 172_800_000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: sid("lost", "3"),
        type: "add_tag",
        config: { tagName: "Remarketing futuro" },
      },
    ],
  },
};

const T_COLD_REENGAGE: AutomationTemplate = {
  id: "cold-reengagement",
  name: "Reativar contato frio",
  tagline: "Oferta + CTA curto para contatos marcados como frios há tempos.",
  description:
    "Funciona em conjunto com uma tag 'Frio'. Envia mensagem direta com oferta/novidade e uma pergunta simples de 'sim/não' pra voltar ao radar do vendedor.",
  category: "retencao",
  icon: Repeat,
  accent: "fuchsia",
  ready: false,
  setupMinutes: 2,
  automation: {
    name: "Reativar contato frio",
    description: "Reengajamento de contatos parados com oferta curta.",
    triggerType: "tag_added",
    triggerConfig: { tagName: "Frio" },
    steps: [
      {
        id: sid("cold", "1"),
        type: "send_whatsapp_message",
        config: {
          content:
            "Oi, {{first_name}}! Faz um tempinho que não conversamos — e temos novidades que podem fazer sentido pra você. 👀",
        },
      },
      {
        id: sid("cold", "2"),
        type: "question",
        config: {
          message: "Consigo te mandar um resumo de 30 segundos?",
          buttons: [
            { id: "y", title: "Manda sim" },
            { id: "n", title: "Agora não" },
          ],
          saveToVariable: "reativacao_aceita",
          timeoutMs: 172_800_000,
          timeoutAction: "stop",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
    ],
  },
};

const T_OUT_OF_HOURS: AutomationTemplate = {
  id: "out-of-hours",
  name: "Resposta fora do horário comercial",
  tagline: "Mensagem automática quando cliente escreve fora do expediente.",
  description:
    "Checa o horário comercial (Seg-Sex 9h-18h por padrão). Se estiver fora, responde com previsão de retorno e tagueia o contato para priorização no próximo dia útil.",
  category: "atendimento",
  icon: CalendarClock,
  accent: "amber",
  popular: true,
  ready: true,
  setupMinutes: 2,
  automation: {
    name: "Resposta fora do horário",
    description: "Mensagem automática quando a mensagem chega fora do expediente.",
    triggerType: "message_received",
    triggerConfig: { channel: "whatsapp" },
    steps: [
      {
        id: sid("ooh", "1"),
        type: "business_hours",
        config: {
          schedule: [
            { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" },
          ],
          timezone: "America/Sao_Paulo",
          elseStepId: sid("ooh", "2"),
        },
      },
      {
        id: sid("ooh", "2"),
        type: "send_whatsapp_message",
        config: {
          content:
            "Oi, {{first_name}}! Recebemos sua mensagem fora do nosso horário de atendimento (Seg-Sex, 9h às 18h). Retornamos assim que possível. ⏰",
        },
      },
      {
        id: sid("ooh", "3"),
        type: "add_tag",
        config: { tagName: "Aguardando retorno no horário" },
      },
    ],
  },
};

const T_ROUND_ROBIN: AutomationTemplate = {
  id: "lead-round-robin",
  name: "Distribuição de leads (round-robin)",
  tagline: "Atribui cada novo contato a um vendedor em rodízio.",
  description:
    "Evita que leads novos fiquem sem dono. A cada novo contato, atribui o próximo vendedor da lista em sistema rotativo e cria tarefa de primeiro contato em 1h.",
  category: "leads",
  icon: Users,
  accent: "blue",
  ready: false,
  setupMinutes: 3,
  automation: {
    name: "Distribuição automática de leads",
    description: "Rodízio entre vendedores para não deixar lead sem dono.",
    triggerType: "contact_created",
    triggerConfig: {},
    steps: [
      {
        id: sid("rr", "1"),
        type: "assign_owner",
        config: { userId: "" },
      },
      {
        id: sid("rr", "2"),
        type: "create_activity",
        config: {
          type: "TASK",
          title: "Primeiro contato com {{first_name}}",
          description: "Responder em até 1h para maximizar conversão.",
        },
      },
      {
        id: sid("rr", "3"),
        type: "add_tag",
        config: { tagName: "Lead distribuído" },
      },
    ],
  },
};

const T_BIRTHDAY: AutomationTemplate = {
  id: "contact-birthday",
  name: "Aniversário do contato",
  tagline: "Mensagem personalizada de aniversário + desconto especial.",
  description:
    "Automação emocional que gera vínculo. Envia mensagem no aniversário do contato com desconto exclusivo e tagueia como 'Data especial' para o vendedor lembrar.",
  category: "retencao",
  icon: Cake,
  accent: "rose",
  ready: false,
  setupMinutes: 2,
  automation: {
    name: "Aniversário do contato",
    description: "Mensagem personalizada no dia do aniversário com oferta.",
    triggerType: "tag_added",
    triggerConfig: { tagName: "Aniversário hoje" },
    steps: [
      {
        id: sid("bday", "1"),
        type: "send_whatsapp_message",
        config: {
          content:
            "🎂 Feliz aniversário, {{first_name}}! Preparamos um mimo especial para você. Me responda aqui que te passo as condições exclusivas. 🎁",
        },
      },
      {
        id: sid("bday", "2"),
        type: "create_activity",
        config: {
          type: "TASK",
          title: "Enviar oferta de aniversário para {{first_name}}",
          description: "Cliente aniversariante — cupom/benefício especial.",
        },
      },
    ],
  },
};

const T_PROPOSAL_FOLLOWUP: AutomationTemplate = {
  id: "proposal-followup",
  name: "Follow-up de proposta enviada",
  tagline: "Lembra o cliente 2 dias depois se a proposta foi vista.",
  description:
    "Trigger no momento em que o deal entra no estágio 'Proposta enviada'. Aguarda 48h e envia um toque suave + pergunta se houve dúvida.",
  category: "vendas",
  icon: HandCoins,
  accent: "emerald",
  popular: true,
  ready: false,
  setupMinutes: 2,
  automation: {
    name: "Follow-up de proposta",
    description: "Toque após 2 dias da proposta enviada.",
    triggerType: "stage_changed",
    triggerConfig: { fromStageId: "", toStageId: "" },
    steps: [
      { id: sid("prop", "1"), type: "delay", config: { ms: 172_800_000 } },
      {
        id: sid("prop", "2"),
        type: "send_whatsapp_message",
        config: {
          content:
            "Oi, {{first_name}}! Conseguiu dar uma olhada na proposta? Posso esclarecer qualquer ponto — é só me dizer. 📄",
        },
      },
      {
        id: sid("prop", "3"),
        type: "question",
        config: {
          message: "Como está o andamento por aí?",
          buttons: [
            { id: "p1", title: "Tenho dúvidas" },
            { id: "p2", title: "Vou decidir em breve" },
            { id: "p3", title: "Preciso de mais tempo" },
          ],
          saveToVariable: "status_proposta",
          timeoutMs: 172_800_000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
    ],
  },
};

const T_HOT_LEAD: AutomationTemplate = {
  id: "hot-lead-alert",
  name: "Alerta de lead quente",
  tagline: "Avisa o responsável quando lead score bate 80.",
  description:
    "Quando o lead cruza o threshold de pontuação (interação recorrente, formulário, clique), cria atividade urgente para o vendedor responsável e tagueia como 'Quente'.",
  category: "leads",
  icon: Zap,
  accent: "amber",
  ready: true,
  setupMinutes: 1,
  automation: {
    name: "Alerta de lead quente",
    description: "Acionado quando score ultrapassa o limite definido.",
    triggerType: "lead_score_reached",
    triggerConfig: { threshold: 80 },
    steps: [
      {
        id: sid("hot", "1"),
        type: "add_tag",
        config: { tagName: "Quente" },
      },
      {
        id: sid("hot", "2"),
        type: "create_activity",
        config: {
          type: "TASK",
          title: "⚡ Contactar lead quente {{first_name}} agora",
          description: "Score ≥ 80 — alta probabilidade de fechamento.",
        },
      },
      {
        id: sid("hot", "3"),
        type: "send_whatsapp_message",
        config: {
          content:
            "Oi, {{first_name}}! Percebi que você tem estado bastante ativo por aqui — isso é ótimo! 🙌 Quer que a gente agende uma conversa rápida hoje mesmo?",
        },
      },
    ],
  },
};

const T_NPS_DETRACTOR: AutomationTemplate = {
  id: "nps-detractor-recovery",
  name: "Resgate de cliente detrator",
  tagline: "Quando NPS é baixo, cria tarefa urgente + ping do CS.",
  description:
    "Complemento do fluxo de onboarding. Se o cliente responde NPS de 0-6, dispara mensagem empática e tarefa prioritária para Customer Success reverter a insatisfação.",
  category: "pos-venda",
  icon: HeartHandshake,
  accent: "rose",
  ready: false,
  setupMinutes: 2,
  automation: {
    name: "Resgate de cliente detrator",
    description: "Ação imediata quando NPS é 0-6.",
    triggerType: "tag_added",
    triggerConfig: { tagName: "NPS detrator" },
    steps: [
      {
        id: sid("nps", "1"),
        type: "send_whatsapp_message",
        config: {
          content:
            "Oi, {{first_name}}. Obrigado pela sinceridade na avaliação — ela nos ajuda a melhorar. Um membro do nosso time vai te chamar em breve para entender o que podemos ajustar. ❤️",
        },
      },
      {
        id: sid("nps", "2"),
        type: "create_activity",
        config: {
          type: "TASK",
          title: "🚨 Resgatar cliente detrator {{first_name}}",
          description: "NPS ≤ 6 — contato prioritário em até 24h.",
        },
      },
      {
        id: sid("nps", "3"),
        type: "assign_owner",
        config: { userId: "" },
      },
    ],
  },
};

const T_ABANDONED_CHECKOUT: AutomationTemplate = {
  id: "abandoned-checkout",
  name: "Recuperação de checkout abandonado",
  tagline: "3 toques progressivos em 1h, 24h e 72h após o abandono.",
  description:
    "Acionado pela tag 'Checkout abandonado' (ex: via webhook do e-commerce). Sequência que vai de amigável a uma oferta com gatilho de escassez no último toque.",
  category: "vendas",
  icon: BadgeCheck,
  accent: "fuchsia",
  ready: false,
  setupMinutes: 3,
  automation: {
    name: "Checkout abandonado",
    description: "Recuperação em 3 toques espaçados.",
    triggerType: "tag_added",
    triggerConfig: { tagName: "Checkout abandonado" },
    steps: [
      { id: sid("abc", "1"), type: "delay", config: { ms: 3_600_000 } },
      {
        id: sid("abc", "2"),
        type: "send_whatsapp_message",
        config: {
          content:
            "Oi, {{first_name}}! Vi que você começou sua compra e não finalizou. Posso te ajudar com alguma coisa? 🛒",
        },
      },
      { id: sid("abc", "3"), type: "delay", config: { ms: 82_800_000 } },
      {
        id: sid("abc", "4"),
        type: "send_whatsapp_message",
        config: {
          content:
            "Ainda dá tempo de concluir — os itens do seu carrinho estão reservados. É só me chamar que te mando o link. 🛍️",
        },
      },
      { id: sid("abc", "5"), type: "delay", config: { ms: 172_800_000 } },
      {
        id: sid("abc", "6"),
        type: "send_whatsapp_message",
        config: {
          content:
            "Último aviso: separei um cupom de 10% que vence hoje. Quer que eu te envie? 💸",
        },
      },
    ],
  },
};

import { IMPORTED_AUTOMATION_TEMPLATES } from "./automation-templates-imported";

const CURATED_TEMPLATES: AutomationTemplate[] = [
  T_WELCOME,
  T_QUALIFY_BANT,
  T_MATRICULA,
  T_HOT_LEAD,
  T_ROUND_ROBIN,
  T_STALLED_DEAL,
  T_PROPOSAL_FOLLOWUP,
  T_POST_DEMO,
  T_LOST_FEEDBACK,
  T_ABANDONED_CHECKOUT,
  T_WON_ONBOARDING,
  T_NPS_DETRACTOR,
  T_COLD_REENGAGE,
  T_BIRTHDAY,
  T_OUT_OF_HOURS,
];

/**
 * Templates importados do ambiente Digisac em produção.
 *
 * Descartamos o bot "Teste" porque é um esboço incompleto sem valor
 * como referência. Os outros 9 bots representam fluxos reais que o time
 * já valida em produção.
 */
const IMPORTED_FILTERED = IMPORTED_AUTOMATION_TEMPLATES.filter(
  (t) => !/^teste$/i.test(t.name.trim()),
);

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  ...CURATED_TEMPLATES,
  ...IMPORTED_FILTERED,
];

export const CATEGORY_META: Record<
  AutomationTemplateCategory,
  { label: string; description: string }
> = {
  leads: {
    label: "Captação",
    description: "Primeiros passos — receber, qualificar e distribuir leads.",
  },
  vendas: {
    label: "Vendas",
    description: "Follow-ups, propostas e recuperação de oportunidades.",
  },
  educacional: {
    label: "Educacional",
    description: "Fluxos específicos do setor de educação.",
  },
  "pos-venda": {
    label: "Pós-venda",
    description: "Onboarding, NPS e retenção após o fechamento.",
  },
  retencao: {
    label: "Retenção",
    description: "Reativação de contatos frios e datas especiais.",
  },
  atendimento: {
    label: "Atendimento",
    description: "Experiência no suporte e horário comercial.",
  },
};

export function getTemplateById(id: string): AutomationTemplate | undefined {
  return AUTOMATION_TEMPLATES.find((t) => t.id === id);
}

export function getTemplatesByCategory(
  category: AutomationTemplateCategory,
): AutomationTemplate[] {
  return AUTOMATION_TEMPLATES.filter((t) => t.category === category);
}
