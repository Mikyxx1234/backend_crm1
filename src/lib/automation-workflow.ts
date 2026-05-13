import {
  newBranchId,
  summarizeConditionConfig,
  type ConditionConfig,
} from "@/lib/automation-condition";

export type AutomationTriggerType =
  | "stage_changed"
  | "tag_added"
  | "lead_score_reached"
  | "deal_created"
  | "deal_won"
  | "deal_lost"
  | "contact_created"
  | "conversation_created"
  | "lifecycle_changed"
  | "agent_changed"
  | "message_received"
  | "message_sent";

export type AutomationStep = {
  id: string;
  type: string;
  config: Record<string, unknown>;
};

export const AUTOMATION_TRIGGER_TYPES: AutomationTriggerType[] = [
  "stage_changed",
  "tag_added",
  "lead_score_reached",
  "deal_created",
  "deal_won",
  "deal_lost",
  "contact_created",
  "conversation_created",
  "lifecycle_changed",
  "agent_changed",
  "message_received",
  "message_sent",
];

export const ACTION_STEP_TYPES = [
  "send_email",
  "move_stage",
  "assign_owner",
  "add_tag",
  "remove_tag",
  "update_field",
  "create_activity",
  "send_whatsapp_message",
  "send_whatsapp_template",
  "send_whatsapp_media",
  "send_whatsapp_interactive",
  "webhook",
  "delay",
  "condition",
  "update_lead_score",
  "question",
  "wait_for_reply",
  "set_variable",
  "goto",
  "transfer_automation",
  "stop_automation",
  "finish",
  "create_deal",
  "finish_conversation",
  "business_hours",
  "ask_ai_agent",
  "transfer_to_ai_agent",
] as const;

export type ActionStepType = (typeof ACTION_STEP_TYPES)[number];

export function triggerTypeLabel(t: string): string {
  const map: Record<string, string> = {
    stage_changed: "Estágio alterado",
    tag_added: "Tag adicionada",
    lead_score_reached: "Lead score atingido",
    deal_created: "Negócio criado",
    deal_won: "Negócio ganho",
    deal_lost: "Negócio perdido",
    contact_created: "Contato criado",
    conversation_created: "Conversa criada",
    lifecycle_changed: "Ciclo de vida alterado",
    agent_changed: "Agente alterado",
    message_received: "Mensagem recebida",
    message_sent: "Mensagem enviada",
  };
  return map[t] ?? t;
}

export function stepTypeLabel(t: string): string {
  const map: Record<string, string> = {
    send_email: "Enviar e-mail",
    move_stage: "Mover estágio",
    assign_owner: "Atribuir responsável",
    add_tag: "Adicionar tag",
    remove_tag: "Remover tag",
    update_field: "Atualizar campo",
    create_activity: "Criar atividade",
    send_whatsapp_message: "Mensagem WhatsApp",
    send_whatsapp_template: "Template WhatsApp",
    send_whatsapp_media: "Mídia WhatsApp",
    send_whatsapp_interactive: "Botões WhatsApp",
    webhook: "Webhook",
    delay: "Atraso",
    condition: "Condição",
    update_lead_score: "Atualizar lead score",
    question: "Pergunta ao lead",
    wait_for_reply: "Aguardar resposta",
    set_variable: "Definir variável",
    goto: "Ir para (Goto)",
    transfer_automation: "Transferir automação",
    stop_automation: "Encerrar automação",
    finish: "Finalizar fluxo",
    create_deal: "Criar negócio",
    finish_conversation: "Encerrar conversa",
    business_hours: "Horário comercial",
    ask_ai_agent: "Perguntar ao agente IA",
    transfer_to_ai_agent: "Transferir para agente IA",
  };
  return map[t] ?? t;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export function summarizeTriggerConfig(triggerType: string, triggerConfig: unknown): string {
  const c = asRecord(triggerConfig);
  switch (triggerType) {
    case "stage_changed": {
      const parts: string[] = [];
      if (c.fromStageId) parts.push(`De: ${String(c.fromStageId)}`);
      if (c.toStageId) parts.push(`Para: ${String(c.toStageId)}`);
      return parts.length ? parts.join(" · ") : "Qualquer mudança de estágio";
    }
    case "tag_added": {
      if (c.tagName) return `Tag: ${String(c.tagName)}`;
      if (c.tagId) return `ID: ${String(c.tagId)}`;
      return "Qualquer tag";
    }
    case "lead_score_reached":
      return `Mín.: ${c.threshold ?? c.minScore ?? "—"}`;
    case "deal_created":
    case "deal_won":
    case "deal_lost":
      return c.pipelineId ? `Pipeline: ${String(c.pipelineId)}` : "Qualquer pipeline";
    case "contact_created":
      return "Novo contato";
    case "conversation_created":
      return c.channel ? `Canal: ${String(c.channel)}` : "Qualquer canal";
    case "lifecycle_changed": {
      const to = c.toLifecycle ?? c.lifecycleStage;
      const from = c.fromLifecycle ?? c.from;
      if (to && from) return `${String(from)} → ${String(to)}`;
      if (to) return `Para: ${String(to)}`;
      return "Qualquer mudança";
    }
    case "agent_changed": {
      const toAgent = c.toAgentId;
      return toAgent ? `Agente: ${String(toAgent)}` : "Qualquer agente";
    }
    case "message_received":
    case "message_sent": {
      const ch = c.channel;
      return ch ? `Canal: ${String(ch)}` : "Qualquer canal";
    }
    default:
      return "—";
  }
}

export function summarizeStepConfig(stepType: string, config: unknown, lookup?: Record<string, string>): string {
  const c = asRecord(config);
  switch (stepType) {
    case "send_email":
      return c.subject ? String(c.subject) : c.to ? `Para: ${String(c.to)}` : "Configurar e-mail";
    case "move_stage": {
      if (c.stageName) return String(c.stageName);
      const sid = c.stageId ? String(c.stageId) : "";
      if (sid && lookup?.[sid]) return lookup[sid];
      return sid ? `Estágio: ${sid.slice(0, 12)}…` : "Definir estágio";
    }
    case "assign_owner":
      return c.userId ? `Usuário: ${String(c.userId)}` : "Definir usuário";
    case "add_tag":
    case "remove_tag":
      return c.tagName ? String(c.tagName) : c.tagId ? `ID: ${String(c.tagId)}` : "Definir tag";
    case "update_field":
      return c.field ? `${String(c.field)} = ${String(c.value ?? "")}` : "Campo / valor";
    case "create_activity":
      return c.title ? String(c.title) : "Nova atividade";
    case "send_whatsapp_message":
      return c.content
        ? String(c.content).slice(0, 40) + (String(c.content).length > 40 ? "…" : "")
        : "Mensagem";
    case "send_whatsapp_template": {
      const tplLabel = c.templateLabel ? String(c.templateLabel) : "";
      const tplName = c.templateName ? String(c.templateName) : "";
      return tplLabel || tplName || "Template";
    }
    case "send_whatsapp_media": {
      const mtype = c.mediaType ?? "image";
      const mtypeLabel: Record<string, string> = { image: "Imagem", video: "Vídeo", audio: "Áudio", document: "Documento" };
      const caption = c.caption ? `: ${String(c.caption).slice(0, 30)}` : "";
      return `${mtypeLabel[String(mtype)] ?? String(mtype)}${caption}`;
    }
    case "send_whatsapp_interactive": {
      const btns = Array.isArray(c.buttons) ? c.buttons.length : 0;
      const bodyText = c.body ? String(c.body).slice(0, 30) : "";
      return btns > 0 ? `[${btns} botões] ${bodyText}` : bodyText || "Configurar botões";
    }
    case "webhook":
      return c.url ? String(c.url).replace(/^https?:\/\//, "").slice(0, 36) : "URL";
    case "delay": {
      const ms = Number(c.ms ?? c.milliseconds ?? 0);
      if (ms >= 86_400_000) return `${ms / 86_400_000} d`;
      if (ms >= 3_600_000) return `${ms / 3_600_000} h`;
      if (ms >= 60_000) return `${ms / 60_000} min`;
      return ms ? `${ms / 1000} s` : "Duração";
    }
    case "condition":
      return summarizeConditionConfig(c);
    case "update_lead_score":
      return "Recalcular score";
    case "question": {
      const msg = c.message ?? c.question;
      const btns = Array.isArray(c.buttons) ? c.buttons : [];
      const prefix = btns.length > 0 ? `[${btns.length} botões] ` : "";
      return msg ? prefix + String(msg).slice(0, 40) + (String(msg).length > 40 ? "…" : "") : "Aguardando resposta";
    }
    case "wait_for_reply": {
      const timeoutMs = Number(c.timeoutMs ?? 0);
      const parts: string[] = ["Até a mensagem recebida"];
      if (timeoutMs > 0) {
        if (timeoutMs >= 3_600_000) parts.push(`⏱ ${timeoutMs / 3_600_000}h`);
        else if (timeoutMs >= 60_000) parts.push(`⏱ ${timeoutMs / 60_000}min`);
        else parts.push(`⏱ ${timeoutMs / 1000}s`);
      }
      return parts.join(" · ");
    }
    case "finish":
      return "Encerrar automação";
    case "set_variable": {
      const name = c.variableName ?? c.name;
      return name ? `{{${String(name)}}} = ${String(c.value ?? "…")}` : "Definir variável";
    }
    case "goto": {
      const target = c.targetStepId;
      return target ? `Ir para: ${String(target).slice(0, 12)}` : "Definir destino";
    }
    case "transfer_automation": {
      const tName = c.targetAutomationName ?? c.targetAutomationId;
      return tName ? `→ ${String(tName)}` : "Selecionar automação";
    }
    case "stop_automation":
      return "Parar automação atual";
    case "create_deal": {
      const title = c.title ? String(c.title) : "";
      return title || "Novo negócio";
    }
    case "finish_conversation":
      return "Resolver conversas abertas";
    case "business_hours": {
      const tz = c.timezone ? String(c.timezone) : "America/Sao_Paulo";
      return `Fuso: ${tz}`;
    }
    case "ask_ai_agent": {
      const agentName = c.agentLabel ?? c.agentName;
      if (agentName) return `Agente: ${String(agentName)}`;
      return c.agentId ? `ID: ${String(c.agentId).slice(0, 8)}…` : "Selecionar agente";
    }
    case "transfer_to_ai_agent": {
      const agentName = c.agentLabel;
      if (agentName) return `→ ${String(agentName)}`;
      return c.agentUserId
        ? `ID: ${String(c.agentUserId).slice(0, 8)}…`
        : "Selecionar agente IA";
    }
    default:
      return "—";
  }
}

/**
 * Retorna true quando o passo não tem a configuração mínima pra executar
 * sem falhar em runtime. Usado no canvas pra destacar visualmente steps
 * incompletos — o operador não precisa esperar a automação rodar e falhar
 * pra descobrir que esqueceu de preencher um texto obrigatório.
 */
export function isStepIncomplete(stepType: string, config: unknown): boolean {
  const c = typeof config === "object" && config !== null ? (config as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  switch (stepType) {
    case "send_whatsapp_message":
      return !str(c.content);
    case "send_whatsapp_template":
      return !str(c.templateName);
    case "send_whatsapp_media":
      return !str(c.mediaUrl) && !str(c.mediaId);
    case "send_whatsapp_interactive":
      return !str(c.body) || !(Array.isArray(c.buttons) && c.buttons.length > 0);
    case "send_email":
      return !str(c.to) || !str(c.subject) || !str(c.body);
    case "webhook":
      return !str(c.url);
    case "question":
      return !(str(c.message) || str(c.question));
    case "goto":
      return !str(c.targetStepId);
    case "transfer_automation":
      return !str(c.targetAutomationId);
    case "ask_ai_agent":
      return !str(c.agentId);
    case "transfer_to_ai_agent":
      return !str(c.agentUserId);
    default:
      return false;
  }
}

export function defaultStepConfig(stepType: string): Record<string, unknown> {
  switch (stepType) {
    case "send_email":
      return { to: "", subject: "", body: "" };
    case "move_stage":
      return { stageId: "" };
    case "assign_owner":
      return { userId: "" };
    case "add_tag":
    case "remove_tag":
      return { tagName: "" };
    case "update_field":
      return { field: "", value: "" };
    case "create_activity":
      return { type: "TASK", title: "", description: "" };
    case "send_whatsapp_message":
      return { content: "" };
    case "send_whatsapp_template":
      return { templateName: "", languageCode: "pt_BR" };
    case "send_whatsapp_media":
      return { mediaType: "image", mediaUrl: "", caption: "" };
    case "send_whatsapp_interactive":
      return { body: "", buttons: [], header: "", footer: "", elseGotoStepId: "", saveToVariable: "" };
    case "webhook":
      return { url: "", method: "POST" };
    case "delay":
      return { ms: 60_000 };
    case "condition": {
      const cfg: ConditionConfig = {
        branches: [
          {
            id: newBranchId(),
            rules: [{ field: "", op: "eq", value: "" }],
          },
        ],
      };
      return cfg as unknown as Record<string, unknown>;
    }
    case "update_lead_score":
      return {};
    case "question":
      return {
        message: "", buttons: [], saveToVariable: "",
        timeoutMs: 86_400_000, timeoutAction: "continue",
        timeoutGotoStepId: "", elseGotoStepId: "",
      };
    case "wait_for_reply":
      return {
        timeoutMs: 60_000, receivedGotoStepId: "", timeoutGotoStepId: "",
      };
    case "finish":
      return { action: "stop" };
    case "set_variable":
      return { variableName: "", value: "" };
    case "goto":
      return { targetStepId: "" };
    case "transfer_automation":
      return { targetAutomationId: "", targetAutomationName: "" };
    case "stop_automation":
      return {};
    case "create_deal":
      return { stageId: "", title: "Novo negócio", value: 0 };
    case "finish_conversation":
      return {};
    case "business_hours":
      return {
        schedule: [
          { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" },
        ],
        timezone: "America/Sao_Paulo",
        elseStepId: "",
      };
    case "ask_ai_agent":
      return {
        agentId: "",
        agentLabel: "",
        /// Variáveis interpoladas com {{var}} são substituidas antes de
        /// enviar pro LLM. O resultado fica disponível como variável
        /// do contexto do nome abaixo.
        promptTemplate: "",
        saveToVariable: "ai_response",
      };
    case "transfer_to_ai_agent":
      return {
        agentUserId: "",
        agentLabel: "",
        // "deal" propaga via assignDealOwner; "contact" via
        // propagateOwnerToContactAndChat. Ambos acabam setando
        // conversation.assignedToId, que é o que `maybeReplyAsAIAgent`
        // olha pra decidir se assume a conversa.
        target: "deal",
      };
    default:
      return {};
  }
}

export function newStepId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `step_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export type ApiAutomationStep = {
  id: string;
  type: string;
  config: unknown;
  position: number;
};

export function apiStepsToWorkflow(steps: ApiAutomationStep[]): AutomationStep[] {
  return steps.map((s) => ({
    id: s.id,
    type: s.type,
    config:
      typeof s.config === "object" && s.config !== null && !Array.isArray(s.config)
        ? { ...(s.config as Record<string, unknown>) }
        : {},
  }));
}

export function workflowStepsToPayload(steps: AutomationStep[]): { id: string; type: string; config: unknown }[] {
  return steps.map(({ id, type, config }) => {
    return { id, type, config };
  });
}

export function defaultTriggerConfig(triggerType: string): Record<string, unknown> {
  switch (triggerType) {
    case "stage_changed":
      return { fromStageId: "", toStageId: "" };
    case "tag_added":
      return { tagName: "" };
    case "lead_score_reached":
      return { threshold: 50 };
    case "deal_created":
    case "deal_won":
    case "deal_lost":
      return { pipelineId: "" };
    case "contact_created":
      return {};
    case "conversation_created":
      return { channel: "" };
    case "lifecycle_changed":
      return { fromLifecycle: "", toLifecycle: "" };
    case "agent_changed":
      return { toAgentId: "" };
    case "message_received":
    case "message_sent":
      return { channel: "" };
    default:
      return {};
  }
}
