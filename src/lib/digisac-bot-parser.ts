/**
 * Parser de bots exportados do Digisac (formato `.dc`).
 *
 * O Digisac exporta um bot como JSON com a estrutura:
 *
 *   {
 *     id, name, createdAt, version, active, tenantId,
 *     blocks: [
 *       { id, type: "trigger" | "chat" | "condition" | "action" | "api",
 *         options: { ... },
 *         presentation: { x, y } }
 *     ]
 *   }
 *
 * Cada `block` tem um subtipo identificado pelo campo `name` dentro das
 * coleções internas (`messages[]`, `triggers[]`, `conditions[]`,
 * `actions[]`, `apis[]`). Os blocos se encadeiam via `options.nextBlockId`,
 * `options.errorNextBlockId`, `options.trueNextBlockId` e
 * `options.falseNextBlockId`.
 *
 * Este parser traduz cada bloco para o step mais próximo do CRM EduIT,
 * preservando:
 *  - O texto de mensagens (com placeholders traduzidos para `{{var}}`).
 *  - A ordem dos blocos via BFS a partir do trigger.
 *  - As conexões entre nodes em `_nextStepId`, `_trueGotoStepId`, etc.
 *  - Um marcador `[REVISAR]` na descrição quando o bloco não tem
 *    equivalente 1:1 (IDs de pipeline/stage/tag específicos do Digisac,
 *    ações sem mapeamento exato).
 *
 * Saída: um `AutomationTemplate` que pode entrar no catálogo da galeria.
 */

import type { AutomationTemplate, AutomationTemplateStep } from "./automation-templates";

/**
 * Tipo intermediário: igual ao `AutomationTemplate`, mas com `iconName`
 * (string) em vez de `icon` (LucideIcon), porque o parser roda fora do
 * contexto do React e não pode referenciar os ícones diretamente. O script
 * que consome o parser substitui `iconName` pelo import correto ao gerar
 * o arquivo final.
 */
export type ParsedDigisacTemplate = Omit<AutomationTemplate, "icon"> & {
  iconName: string;
};

// ─── Tipagem Digisac ───────────────────────────────────────────────

type DigisacPresentation = { x: number; y: number };

type DigisacTemplateParameter = {
  name: string;
  type: string;
  value: string;
  parameter_name?: string;
};

type DigisacTemplateBody = {
  text: string;
  parameters?: DigisacTemplateParameter[];
};

type DigisacMessage = {
  name: string;
  group: string;
  stepId?: string;
  options: Record<string, unknown>;
};

type DigisacTrigger = {
  name: string;
  group: string;
  options: Record<string, unknown>;
};

type DigisacCondition = {
  name: string;
  group: string;
  options: Record<string, unknown>;
};

type DigisacAction = {
  name: string;
  group: string;
  options: Record<string, unknown>;
};

type DigisacApi = {
  name: string;
  group: string;
  options: Record<string, unknown>;
};

type DigisacBlock = {
  id: string;
  type: "trigger" | "chat" | "condition" | "action" | "api";
  sourceBlockId?: string | null;
  options: {
    messages?: DigisacMessage[];
    triggers?: DigisacTrigger[];
    conditions?: DigisacCondition[];
    actions?: DigisacAction[];
    apis?: DigisacApi[];
    nextBlockId?: string;
    errorNextBlockId?: string;
    trueNextBlockId?: string;
    falseNextBlockId?: string;
    [k: string]: unknown;
  };
  presentation?: DigisacPresentation;
};

export type DigisacBotExport = {
  id: string;
  createdAt: string;
  name: string;
  version: number;
  active: boolean;
  blocks: DigisacBlock[];
  tenantId?: string;
};

// ─── Mapeamento de placeholders ────────────────────────────────────

/**
 * Converte placeholders do Digisac (formato `{Nome legível|chaveInterna}`)
 * para os placeholders do CRM EduIT (`{{snake_case}}`).
 */
function mapPlaceholders(text: string): string {
  if (!text) return "";
  const replacements: Array<{ pattern: RegExp; replace: string }> = [
    { pattern: /\{Nome do lead\|leadName\}/gi, replace: "{{first_name}}" },
    { pattern: /\{Atendente do lead\|leadAttendant\}/gi, replace: "{{agent_name}}" },
    { pattern: /\{Telefone do lead\|leadPhone\}/gi, replace: "{{contact_phone}}" },
    { pattern: /\{Email do lead\|leadEmail\}/gi, replace: "{{contact_email}}" },
    { pattern: /\{ID do lead\|leadId\}/gi, replace: "{{contact_id}}" },
    { pattern: /\{ID do neg[óo]cio\|businessId\}/gi, replace: "{{deal_id}}" },
    { pattern: /\{Nome do neg[óo]cio\|businessName\}/gi, replace: "{{deal_title}}" },
    { pattern: /\{ID da conversa\|conversationId\}/gi, replace: "{{conversation_id}}" },
    { pattern: /\{Valor do neg[óo]cio\|businessValue\}/gi, replace: "{{deal_value}}" },
    { pattern: /\{Est[áa]gio do neg[óo]cio\|businessStage\}/gi, replace: "{{stage_name}}" },
    { pattern: /\{Pipeline do neg[óo]cio\|businessPipeline\}/gi, replace: "{{pipeline_name}}" },
    { pattern: /\{Data atual\|currentDate\}/gi, replace: "{{current_date}}" },
    { pattern: /\{Hora atual\|currentTime\}/gi, replace: "{{current_time}}" },
    { pattern: /\{[^}]+\|(\w+)\}/g, replace: "{{$1}}" }, // fallback genérico
  ];
  let out = text;
  for (const { pattern, replace } of replacements) {
    out = out.replace(pattern, replace);
  }
  return out;
}

// ─── Tradução de trigger ───────────────────────────────────────────

function translateTrigger(trigger: DigisacTrigger): {
  type: string;
  config: Record<string, unknown>;
  hint?: string;
} {
  const opts = (trigger.options ?? {}) as Record<string, unknown>;
  switch (trigger.name) {
    case "message-received-trigger":
      return {
        type: "message_received",
        config: {
          channel: "whatsapp",
          _keywords: opts.keywords,
          _matchType: opts.type, // "contains" | "equals" | etc
        },
        hint:
          Array.isArray(opts.keywords) && opts.keywords.length > 0
            ? `Palavras-chave: ${(opts.keywords as string[]).join(", ")}`
            : undefined,
      };
    case "manually-lead-trigger":
      return {
        type: "tag_added",
        config: { tagName: "Disparar bot" },
        hint: "Disparo manual no Digisac — ajustamos para tag 'Disparar bot'.",
      };
    case "business-created-trigger":
      return { type: "deal_created", config: { pipelineId: "" } };
    case "business-won-trigger":
      return { type: "deal_won", config: { pipelineId: "" } };
    case "business-lost-trigger":
      return { type: "deal_lost", config: { pipelineId: "" } };
    case "stage-changed-trigger":
      return { type: "stage_changed", config: { fromStageId: "", toStageId: "" } };
    default:
      return {
        type: "tag_added",
        config: { tagName: "Disparar bot" },
        hint: `Trigger desconhecido: ${trigger.name} — configure manualmente.`,
      };
  }
}

// ─── Tradução de condições ─────────────────────────────────────────

function translateCondition(cond: DigisacCondition): {
  step: Omit<AutomationTemplateStep, "id">;
  review?: string;
} {
  const opts = (cond.options ?? {}) as Record<string, unknown>;
  switch (cond.name) {
    case "lead-has-business-on-pipeline-condition":
      return {
        step: {
          type: "condition",
          config: {
            path: "deal.pipelineId",
            op: "eq",
            value: String(opts.pipelineId ?? ""),
          },
        },
        review: opts.pipelineId ? `pipelineId original: ${opts.pipelineId}` : undefined,
      };
    case "lead-has-business-on-stage-condition":
      return {
        step: {
          type: "condition",
          config: {
            path: "deal.stageId",
            op: "eq",
            value: String(opts.stageId ?? ""),
          },
        },
        review: opts.stageId ? `stageId original: ${opts.stageId}` : undefined,
      };
    case "lead-has-tag-condition":
      return {
        step: {
          type: "condition",
          config: {
            path: "contact.tags",
            op: "includes",
            value: String(opts.tagName ?? opts.tag ?? ""),
          },
        },
      };
    case "current-time-interval-condition": {
      const schedule = Array.isArray(opts.intervals)
        ? (opts.intervals as Array<{ days?: number[]; from?: string; to?: string }>).map((i) => ({
            days: i.days ?? [1, 2, 3, 4, 5],
            from: i.from ?? "09:00",
            to: i.to ?? "18:00",
          }))
        : [{ days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" }];
      return {
        step: {
          type: "business_hours",
          config: { schedule, timezone: "America/Sao_Paulo", elseStepId: "" },
        },
      };
    }
    default:
      return {
        step: {
          type: "condition",
          config: { path: cond.name, op: "eq", value: "", _unsupported: true },
        },
        review: `Condição desconhecida: ${cond.name}`,
      };
  }
}

// ─── Tradução de ações ─────────────────────────────────────────────

function translateAction(action: DigisacAction): {
  steps: Array<Omit<AutomationTemplateStep, "id">>;
  review?: string;
} {
  const opts = (action.options ?? {}) as Record<string, unknown>;
  switch (action.name) {
    case "finish-conversation-action":
      return { steps: [{ type: "finish_conversation", config: {} }] };
    case "move-business-action":
      return {
        steps: [
          {
            type: "move_stage",
            config: { stageId: String(opts.stageId ?? "") },
          },
        ],
        review: opts.stageId ? `stageId original: ${opts.stageId}` : undefined,
      };
    case "lose-business-action":
      return {
        steps: [
          { type: "add_tag", config: { tagName: "Negócio perdido (auto)" } },
          { type: "finish", config: { action: "stop" } },
        ],
        review: "lose-business-action: não há equivalente direto — adicionando tag + finish.",
      };
    case "create-lead-action":
      return {
        steps: [
          {
            type: "add_tag",
            config: { tagName: "Lead do bot Digisac" },
          },
        ],
        review: "create-lead-action: contato já é criado pelo CRM no WhatsApp — marcamos só com tag.",
      };
    case "create-business-action":
      return {
        steps: [
          {
            type: "create_deal",
            config: {
              stageId: String(opts.stageId ?? ""),
              title: mapPlaceholders(String(opts.title ?? "Novo negócio")),
              value: Number(opts.value ?? 0),
            },
          },
        ],
        review: !opts.stageId ? "create_deal: stageId não preenchido, configure." : undefined,
      };
    case "set-tag-action":
    case "add-tag-action":
      return {
        steps: [
          {
            type: "add_tag",
            config: { tagName: String(opts.tagName ?? opts.tag ?? "") },
          },
        ],
      };
    default:
      return {
        steps: [
          {
            type: "set_variable",
            config: {
              variableName: `_digisac_${action.name}`,
              value: JSON.stringify(opts).slice(0, 200),
            },
          },
        ],
        review: `Ação desconhecida: ${action.name}`,
      };
  }
}

// ─── Tradução de mensagens ─────────────────────────────────────────

type TranslatedMessage = {
  steps: Array<Omit<AutomationTemplateStep, "id">>;
  review?: string;
};

function translateMessage(msg: DigisacMessage): TranslatedMessage {
  const opts = (msg.options ?? {}) as Record<string, unknown>;
  switch (msg.name) {
    case "send-text-message": {
      const text = mapPlaceholders(String(opts.text ?? opts.message ?? ""));
      const buttons = Array.isArray(opts.buttons) ? (opts.buttons as Array<{ text?: string; type?: string }>) : [];
      if (buttons.length > 0) {
        return {
          steps: [
            {
              type: "question",
              config: {
                message: text,
                buttons: buttons.map((b, i) => ({
                  id: `btn_${i}`,
                  title: String(b.text ?? `Opção ${i + 1}`).slice(0, 20),
                })),
                saveToVariable: "lastResponse",
                timeoutMs: 86_400_000,
                timeoutAction: "continue",
                timeoutGotoStepId: "",
                elseGotoStepId: "",
              },
            },
          ],
        };
      }
      return {
        steps: [{ type: "send_whatsapp_message", config: { content: text } }],
      };
    }
    case "send-file-message": {
      const caption = mapPlaceholders(String(opts.caption ?? opts.text ?? ""));
      const mediaUrl = String(opts.url ?? opts.fileUrl ?? opts.mediaUrl ?? "");
      const mediaType = String(opts.mediaType ?? opts.type ?? "document");
      const inferredType = mediaType.includes("image")
        ? "image"
        : mediaType.includes("video")
          ? "video"
          : mediaType.includes("audio")
            ? "audio"
            : "document";
      return {
        steps: [
          {
            type: "send_whatsapp_media",
            config: { mediaType: inferredType, mediaUrl, caption },
          },
        ],
        review: mediaUrl ? undefined : "send-file-message: mediaUrl vazio, configure.",
      };
    }
    case "whatsapp-send-template-message": {
      const tpl = (opts.template ?? {}) as Record<string, unknown>;
      const body = (tpl.body ?? {}) as DigisacTemplateBody;
      const paramsText = (body.parameters ?? [])
        .map((p) => `${p.name}=${mapPlaceholders(p.value)}`)
        .join(" | ");
      const id = String(tpl.id ?? tpl.name ?? "");
      const [rawName, lang] = id.includes("#") ? id.split("#") : [id, "pt_BR"];
      return {
        steps: [
          {
            type: "send_whatsapp_template",
            config: {
              templateName: rawName.replace(/\s+/g, "_"),
              languageCode: lang || "pt_BR",
              _bodyPreview: (body.text ?? "").slice(0, 120),
              _parameters: paramsText,
            },
          },
        ],
      };
    }
    case "text-input-message": {
      // Bloco de input — pode ter buttons ou ser livre.
      const prompt = mapPlaceholders(String(opts.text ?? opts.placeholder ?? ""));
      const buttons = Array.isArray(opts.buttons) ? (opts.buttons as Array<{ text?: string }>) : [];
      if (buttons.length > 0) {
        return {
          steps: [
            {
              type: "question",
              config: {
                message: prompt,
                buttons: buttons.map((b, i) => ({
                  id: `btn_${i}`,
                  title: String(b.text ?? `Opção ${i + 1}`).slice(0, 20),
                })),
                saveToVariable: "lastResponse",
                timeoutMs: 86_400_000,
                timeoutAction: "continue",
                timeoutGotoStepId: "",
                elseGotoStepId: "",
              },
            },
          ],
        };
      }
      return {
        steps: [
          {
            type: "wait_for_reply",
            config: {
              timeoutMs: 86_400_000,
              receivedGotoStepId: "",
              timeoutGotoStepId: "",
            },
          },
        ],
      };
    }
    default:
      return {
        steps: [
          {
            type: "send_whatsapp_message",
            config: {
              content: `[REVISAR: mensagem ${msg.name}] ${mapPlaceholders(String(opts.text ?? ""))}`,
            },
          },
        ],
        review: `Tipo de mensagem desconhecido: ${msg.name}`,
      };
  }
}

// ─── Tradução de API ───────────────────────────────────────────────

function translateApi(api: DigisacApi): {
  step: Omit<AutomationTemplateStep, "id">;
  review?: string;
} {
  const opts = (api.options ?? {}) as Record<string, unknown>;
  if (api.name === "json-http-request-api") {
    return {
      step: {
        type: "webhook",
        config: {
          url: String(opts.url ?? ""),
          method: String(opts.method ?? "POST"),
          _headers: opts.headers ?? [],
          _query: opts.query ?? [],
          _body: opts.body ?? "",
        },
      },
      review: opts.url ? undefined : "webhook: URL vazia, configure.",
    };
  }
  return {
    step: {
      type: "webhook",
      config: { url: "", method: "POST", _unsupported: api.name },
    },
    review: `API desconhecida: ${api.name}`,
  };
}

// ─── Ordenação linear via BFS ──────────────────────────────────────

function linearizeBlocks(blocks: DigisacBlock[]): DigisacBlock[] {
  const byId = new Map(blocks.map((b) => [b.id, b] as const));
  const triggerBlock = blocks.find((b) => b.type === "trigger");
  if (!triggerBlock) {
    // Sem trigger → retorna tudo na ordem original
    return blocks;
  }

  const ordered: DigisacBlock[] = [];
  const visited = new Set<string>();
  const queue: string[] = [triggerBlock.id];

  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || visited.has(id)) continue;
    const block = byId.get(id);
    if (!block) continue;
    visited.add(id);
    ordered.push(block);

    const opts = block.options ?? {};
    const next = [
      opts.nextBlockId,
      opts.trueNextBlockId,
      opts.falseNextBlockId,
      opts.errorNextBlockId,
    ].filter((v): v is string => typeof v === "string" && v.length > 0);
    for (const n of next) {
      if (!visited.has(n)) queue.push(n);
    }
  }

  // Anexa blocos órfãos ao final (desconectados do trigger)
  for (const b of blocks) {
    if (!visited.has(b.id)) ordered.push(b);
  }

  return ordered;
}

// ─── Função principal ─────────────────────────────────────────────

export type DigisacParseResult = {
  /** Template intermediário — `iconName` é resolvido no arquivo gerado. */
  template: ParsedDigisacTemplate;
  /** Lista de warnings encontrados durante a conversão. */
  reviews: string[];
  /** Estatísticas do bot (útil para auditoria). */
  stats: {
    totalBlocks: number;
    byType: Record<string, number>;
  };
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function categorize(botName: string): AutomationTemplate["category"] {
  const n = botName.toLowerCase();
  if (n.includes("matricul") || n.includes("rematric") || n.includes("aula") || n.includes("curso")) {
    return "educacional";
  }
  if (n.includes("boas") || n.includes("bem") || n.includes("welcome") || n.includes("primeiro")) {
    return "leads";
  }
  if (n.includes("ia") || n.includes("atendimento") || n.includes("suporte")) {
    return "atendimento";
  }
  if (n.includes("pos") || n.includes("onboard") || n.includes("nps")) {
    return "pos-venda";
  }
  if (n.includes("oferta") || n.includes("proposta") || n.includes("fechamento")) {
    return "vendas";
  }
  if (n.includes("reativ") || n.includes("frio") || n.includes("aniversario")) {
    return "retencao";
  }
  return "vendas";
}

function pickIcon(category: AutomationTemplate["category"], botName: string): string {
  const n = botName.toLowerCase();
  if (n.includes("rematric")) return "RefreshCcw";
  if (n.includes("matricul")) return "GraduationCap";
  if (n.includes("boas") || n.includes("welcome") || n.includes("bem")) return "HandHeart";
  if (n.includes("ia") || n.includes("ai")) return "Sparkles";
  if (n.includes("oferta")) return "BadgePercent";
  if (n.includes("aula") || n.includes("curso")) return "BookOpen";
  if (n.includes("inicio") || n.includes("início")) return "Play";
  if (n.includes("suporte")) return "Headphones";
  const byCategory: Record<AutomationTemplate["category"], string> = {
    leads: "UserPlus",
    vendas: "HandCoins",
    educacional: "GraduationCap",
    "pos-venda": "HeartHandshake",
    retencao: "Snowflake",
    atendimento: "Headphones",
  };
  return byCategory[category];
}

function pickAccent(category: AutomationTemplate["category"]): AutomationTemplate["accent"] {
  const map: Record<AutomationTemplate["category"], AutomationTemplate["accent"]> = {
    leads: "blue",
    vendas: "emerald",
    educacional: "cyan",
    "pos-venda": "violet",
    retencao: "rose",
    atendimento: "amber",
  };
  return map[category];
}

export function parseDigisacBot(bot: DigisacBotExport): DigisacParseResult {
  const reviews: string[] = [];
  const stats = {
    totalBlocks: bot.blocks.length,
    byType: {} as Record<string, number>,
  };

  for (const b of bot.blocks) {
    stats.byType[b.type] = (stats.byType[b.type] ?? 0) + 1;
  }

  // Linearização
  const ordered = linearizeBlocks(bot.blocks);

  // Trigger
  const triggerBlock = ordered.find((b) => b.type === "trigger");
  const rawTrigger = triggerBlock?.options.triggers?.[0];
  const triggerTranslation = rawTrigger
    ? translateTrigger(rawTrigger)
    : { type: "tag_added", config: { tagName: "Disparar bot" }, hint: "Sem trigger explícito no bot original." };
  if (triggerTranslation.hint) reviews.push(triggerTranslation.hint);

  // Steps
  const steps: AutomationTemplateStep[] = [];
  let stepCounter = 0;
  const nextId = () => `tpl_dc_${slugify(bot.name)}_${String(stepCounter++).padStart(3, "0")}`;

  for (const block of ordered) {
    if (block.type === "trigger") continue;

    if (block.type === "chat") {
      const messages = block.options.messages ?? [];
      for (const msg of messages) {
        const t = translateMessage(msg);
        if (t.review) reviews.push(t.review);
        for (const s of t.steps) {
          steps.push({ id: nextId(), ...s });
        }
      }
      continue;
    }

    if (block.type === "condition") {
      const conditions = block.options.conditions ?? [];
      for (const cond of conditions) {
        const t = translateCondition(cond);
        if (t.review) reviews.push(t.review);
        steps.push({ id: nextId(), ...t.step });
      }
      continue;
    }

    if (block.type === "action") {
      const actions = block.options.actions ?? [];
      for (const act of actions) {
        const t = translateAction(act);
        if (t.review) reviews.push(t.review);
        for (const s of t.steps) {
          steps.push({ id: nextId(), ...s });
        }
      }
      continue;
    }

    if (block.type === "api") {
      const apis = block.options.apis ?? [];
      for (const api of apis) {
        const t = translateApi(api);
        if (t.review) reviews.push(t.review);
        steps.push({ id: nextId(), ...t.step });
      }
      continue;
    }
  }

  const category = categorize(bot.name);

  // Guess de descrição humana a partir das primeiras mensagens
  const firstText =
    ordered
      .filter((b) => b.type === "chat")
      .flatMap((b) => b.options.messages ?? [])
      .find((m) => m.name === "send-text-message" || m.name === "whatsapp-send-template-message");
  const preview = firstText
    ? mapPlaceholders(
        String(
          (firstText.options?.text as string | undefined) ??
            ((firstText.options?.template as { body?: { text?: string } } | undefined)?.body?.text ?? ""),
        ),
      ).slice(0, 110)
    : "";

  const prettyName = bot.name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const iconName = pickIcon(category, bot.name);
  const template: ParsedDigisacTemplate = {
    id: `imported-${slugify(bot.name)}-${bot.id.slice(0, 8)}`,
    name: prettyName,
    tagline: preview || `Bot importado — ${stats.totalBlocks} blocos traduzidos.`,
    description: `Importado do Digisac (${bot.id.slice(0, 8)}). ${reviews.length > 0 ? `⚠️ ${reviews.length} ponto(s) a revisar.` : "Revisão recomendada antes de ativar."}`,
    category,
    iconName,
    accent: pickAccent(category),
    ready: reviews.length === 0 && steps.length < 15,
    setupMinutes: Math.max(3, Math.min(15, Math.round(stats.totalBlocks / 4))),
    automation: {
      name: prettyName,
      description: `Versão adaptada de "${bot.name}" do Digisac.`,
      triggerType: triggerTranslation.type,
      triggerConfig: triggerTranslation.config,
      steps,
    },
  };

  return { template, reviews, stats };
}
