/**
 * Copilot de Automações — runner especializado.
 *
 * Diferente do `runAgent` (que é o agente conversacional que fala com
 * contatos), este runner existe pra ajudar o OPERADOR a construir e
 * auditar automações dentro do editor. Por isso:
 *   - Roda com as mesmas tools de LEITURA em cima do grafo (a auditoria
 *     determinística já faz o trabalho pesado; a IA só interpreta).
 *   - "Escreve" propondo PATCHES, nunca aplicando direto — a UI decide.
 *
 * As tools desta lib retornam dados já "digeridos" (resumos textuais
 * curtos + JSON estruturado) pra reduzir tokens e manter o raciocínio
 * do modelo focado.
 */

import { tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";

import {
  auditAutomation,
  describeAutomationForLLM,
  detectCrossConflictCandidates,
  type AutomationLike,
} from "@/lib/automation-auditor";
import {
  ACTION_STEP_TYPES,
  AUTOMATION_TRIGGER_TYPES,
  defaultStepConfig,
  stepTypeLabel,
  triggerTypeLabel,
  type AutomationStep,
} from "@/lib/automation-workflow";
import { prisma } from "@/lib/prisma";
// IMPORTANTE: Copilot roda no Anthropic (Claude), NÃO no OpenAI. O
// provider OpenAI continua servindo os agentes de conversa com
// contato (ver src/services/ai/provider.ts).
import {
  DEFAULT_COPILOT_MODEL,
  generateWithAnthropic,
} from "@/services/ai/anthropic-provider";

/**
 * Estado "ao vivo" do editor no cliente. O usuário pode ter mudanças
 * não salvas — então passamos o grafo ATUAL (não o persistido) como
 * input. As tools de LEITURA da automação atual operam em cima disso.
 */
export type CopilotCurrentAutomation = {
  id?: string | null;
  name: string;
  description?: string | null;
  triggerType: string;
  triggerConfig?: unknown;
  active?: boolean;
  steps: AutomationStep[];
};

export type CopilotPatchOp =
  /** Adiciona um step novo (id opcional — se omitido, a UI gera).
   *  `after` pode ser um stepId; a UI conecta esse step ao novo. */
  | {
      op: "add_step";
      step: { id?: string; type: string; config: Record<string, unknown> };
      /** Quando informado, o patch também conecta o step `after` → novo step
       *  pelo handle `afterHandle` (default "next"). */
      after?: string;
      afterHandle?:
        | "next"
        | "received"
        | "timeout"
        | "else"
        | `branch:${string}`
        | `button:${number}`;
    }
  /** Substitui/merge o config de um step. `merge=true` (default) faz
   *  shallow merge; `merge=false` troca o config inteiro. */
  | {
      op: "update_step_config";
      stepId: string;
      config: Record<string, unknown>;
      merge?: boolean;
    }
  /** Remove um step (e as referências a ele, a UI limpa). */
  | { op: "remove_step"; stepId: string }
  /** Liga `fromStepId` ao `toStepId` por um handle. */
  | {
      op: "connect";
      fromStepId: string;
      toStepId: string;
      handle:
        | "next"
        | "received"
        | "timeout"
        | "else"
        | `branch:${string}`
        | `button:${number}`;
    };

export type CopilotPatch = {
  summary: string;
  reasoning: string;
  ops: CopilotPatchOp[];
};

const SYSTEM_PROMPT = `Você é o Copilot de Automações do CRM EduIT.

Seu trabalho é ajudar o operador a:
  1. Construir automações de comunicação/CRM (leads, pipeline, WhatsApp, IA).
  2. Auditar conflitos entre automações e entre ramos de uma mesma automação.
  3. Sugerir correções específicas na forma de PATCHES (nunca aplique nada — a UI aprova).

Ferramentas disponíveis (use-as antes de responder, sempre que for necessário):
  • get_current_automation — estado ao vivo do editor (o operador pode ter mudanças não salvas)
  • list_other_automations — outras automações ativas (para detectar conflitos)
  • get_automation_details — detalhes de UMA automação específica (resumo compacto)
  • run_audit — motor determinístico de auditoria (referências quebradas, ramos sem saída, loops, etc.)
  • propose_patch — emita um patch com ops do tipo add_step/update_step_config/remove_step/connect

Princípios:
  • SEMPRE chame run_audit antes de sugerir mudanças — pode haver problemas invisíveis a olho nu.
  • Prefira respostas curtas e objetivas. Nada de papo cerimonial.
  • Quando houver dúvida sobre o intento do operador, PERGUNTE em vez de adivinhar.
  • Todo patch deve vir com um "summary" de 1 linha e um "reasoning" explicando por quê.
  • Ao propor step novo, use SEMPRE um dos tipos válidos (veja STEP_TYPES abaixo).
  • Ao conectar steps, use o handle correto pro tipo de step de origem.

STEP_TYPES (tipos válidos de step.type): ${ACTION_STEP_TYPES.join(", ")}
TRIGGER_TYPES (tipos válidos de trigger): ${AUTOMATION_TRIGGER_TYPES.join(", ")}

Handles de conexão por tipo de step:
  • linear (send_*, webhook, delay, set_variable, assign_owner, etc.): handle "next"
  • condition: handle "branch:<branchId>" (um por branch) e "else"
  • wait_for_reply: handles "received" e "timeout"
  • question / send_whatsapp_interactive: "button:<index>" (para cada botão), "else", "timeout", e "next" (após envio linear)
  • business_hours: "next" (dentro do horário) e "else" (fora do horário)

Campos disponíveis em conditions (lado esquerdo das rules — use sempre um destes):
  • Contato: contact.name, contact.email, contact.phone, contact.leadScore (num),
    contact.lifecycleStage, contact.source, contact.companyId, contact.assignedToId,
    contact.whatsappJid
  • Deal: deal.title, deal.value (num), deal.status (OPEN/WON/LOST),
    deal.stageName, deal.pipelineName, deal.lostReason
    (preferir **nome** sobre ID; deal.stageId / deal.pipelineId seguem suportados
    mas são "legado" — só use se o operador pedir explicitamente)
  • Conversa: conversation.status (OPEN/RESOLVED/PENDING/SNOOZED),
    conversation.isClosed (bool — true quando status=RESOLVED, ou seja,
    "conversa fechada"), conversation.channel, conversation.hasError (bool),
    conversation.hasAgentReply (bool), conversation.unreadCount (num)
  • Mensagem/Evento: data.content, data.text, data.direction (in/out),
    data.messageType, event.type, event.channel
  • Variáveis do fluxo: variables.<nome> (definidas via set_variable antes do condition)

Quando descobrir um conflito entre automações, NÃO proponha patch direto — explique a colisão em texto e pergunte se o operador quer que você corrija UMA das duas (e qual).

Sempre responda em português do Brasil.`;

function loadCurrentAutomationAsLike(
  current: CopilotCurrentAutomation,
): AutomationLike {
  return {
    id: current.id ?? "__current__",
    name: current.name,
    triggerType: current.triggerType,
    triggerConfig: current.triggerConfig,
    active: current.active ?? false,
    steps: current.steps.map((s) => ({ id: s.id, type: s.type, config: s.config })),
  };
}

function buildCopilotToolSet(current: CopilotCurrentAutomation): {
  tools: ToolSet;
  /// Referência mutável para coletar patches propostos (a tool
  /// `propose_patch` devolve ok pro LLM mas a UI consome daqui).
  patchesRef: CopilotPatch[];
} {
  const patchesRef: CopilotPatch[] = [];
  const currentLike = loadCurrentAutomationAsLike(current);

  const tools: ToolSet = {
    get_current_automation: tool({
      description:
        "Retorna a automação que o operador está editando no momento (estado ao vivo, pode ter mudanças não salvas). Inclui trigger, quantidade de passos e um resumo textual do grafo.",
      inputSchema: z.object({}),
      execute: async () => {
        return {
          ok: true,
          name: current.name,
          description: current.description ?? null,
          triggerType: current.triggerType,
          triggerLabel: triggerTypeLabel(current.triggerType),
          stepsCount: current.steps.length,
          active: current.active ?? false,
          graph: describeAutomationForLLM(currentLike),
          stepsJson: current.steps.map((s) => ({
            id: s.id,
            type: s.type,
            typeLabel: stepTypeLabel(s.type),
            config: s.config,
          })),
        };
      },
    }),

    list_other_automations: tool({
      description:
        "Lista as outras automações (default: só ativas) com gatilho e tipos de passos que executam. Útil pra detectar conflitos cruzados.",
      inputSchema: z.object({
        includeInactive: z.boolean().optional().default(false),
      }),
      execute: async ({ includeInactive }) => {
        const others = await prisma.automation.findMany({
          where: includeInactive
            ? current.id
              ? { NOT: { id: current.id } }
              : undefined
            : {
                active: true,
                ...(current.id ? { NOT: { id: current.id } } : {}),
              },
          include: { steps: { orderBy: { position: "asc" } } },
          orderBy: { updatedAt: "desc" },
        });
        return {
          ok: true,
          count: others.length,
          automations: others.map((a) => ({
            id: a.id,
            name: a.name,
            triggerType: a.triggerType,
            triggerLabel: triggerTypeLabel(a.triggerType),
            active: a.active,
            stepsCount: a.steps.length,
            stepTypes: Array.from(new Set(a.steps.map((s) => s.type))),
          })),
        };
      },
    }),

    get_automation_details: tool({
      description:
        "Busca detalhes compactos de UMA automação específica pelo id — retorna descrição textual do grafo (passos + conexões).",
      inputSchema: z.object({ automationId: z.string().min(1) }),
      execute: async ({ automationId }) => {
        const a = await prisma.automation.findUnique({
          where: { id: automationId },
          include: { steps: { orderBy: { position: "asc" } } },
        });
        if (!a) return { ok: false, error: "Automação não encontrada." };
        const like: AutomationLike = {
          id: a.id,
          name: a.name,
          triggerType: a.triggerType,
          triggerConfig: a.triggerConfig,
          active: a.active,
          steps: a.steps.map((s) => ({ id: s.id, type: s.type, config: s.config })),
        };
        return {
          ok: true,
          id: a.id,
          name: a.name,
          triggerType: a.triggerType,
          active: a.active,
          description: a.description,
          graph: describeAutomationForLLM(like),
        };
      },
    }),

    run_audit: tool({
      description:
        "Roda o auditor determinístico: retorna erros/warnings/infos encontrados NA AUTOMAÇÃO ATUAL (o que está no editor agora) e candidatos a conflito com outras ativas.",
      inputSchema: z.object({}),
      execute: async () => {
        const report = auditAutomation(currentLike);
        const allActives = await prisma.automation.findMany({
          where: { active: true },
          include: { steps: { orderBy: { position: "asc" } } },
        });
        const allLike: AutomationLike[] = allActives.map((a) => ({
          id: a.id,
          name: a.name,
          triggerType: a.triggerType,
          triggerConfig: a.triggerConfig,
          active: a.active,
          steps: a.steps.map((s) => ({ id: s.id, type: s.type, config: s.config })),
        }));
        // Adiciona a automação atual na lista (caso ainda não exista no banco)
        if (!allLike.find((a) => a.id === currentLike.id)) {
          allLike.push(currentLike);
        }
        const cross = detectCrossConflictCandidates(allLike).filter((c) =>
          c.automationIds.includes(currentLike.id),
        );
        return {
          ok: true,
          automationId: report.automationId,
          summary: `${report.errorCount} erro(s), ${report.warningCount} aviso(s), ${report.infoCount} info(s).`,
          errorCount: report.errorCount,
          warningCount: report.warningCount,
          infoCount: report.infoCount,
          issues: report.issues,
          crossConflictCandidates: cross,
        };
      },
    }),

    default_step_config: tool({
      description:
        "Retorna o config default para um tipo de step — use antes de propor 'add_step' pra não esquecer campos obrigatórios.",
      inputSchema: z.object({
        stepType: z.string().min(1),
      }),
      execute: async ({ stepType }) => {
        if (!ACTION_STEP_TYPES.includes(stepType as (typeof ACTION_STEP_TYPES)[number])) {
          return { ok: false, error: `Tipo "${stepType}" desconhecido. Veja STEP_TYPES.` };
        }
        return {
          ok: true,
          stepType,
          label: stepTypeLabel(stepType),
          defaultConfig: defaultStepConfig(stepType),
        };
      },
    }),

    propose_patch: tool({
      description:
        "Emite um patch com alterações no grafo (add_step, update_step_config, remove_step, connect). O patch NÃO é aplicado — a UI mostra pro operador aprovar. Cada chamada vira um card de diff separado. Use uma única chamada com várias ops quando as mudanças forem interdependentes.",
      inputSchema: z.object({
        summary: z.string().min(1).describe("Resumo de 1 linha do que o patch faz."),
        reasoning: z.string().min(1).describe("Por que essa mudança resolve o problema/pedido."),
        ops: z
          .array(
            z.union([
              z.object({
                op: z.literal("add_step"),
                step: z.object({
                  id: z.string().optional(),
                  type: z.string(),
                  config: z.record(z.string(), z.unknown()),
                }),
                after: z.string().optional(),
                afterHandle: z.string().optional(),
              }),
              z.object({
                op: z.literal("update_step_config"),
                stepId: z.string(),
                config: z.record(z.string(), z.unknown()),
                merge: z.boolean().optional(),
              }),
              z.object({
                op: z.literal("remove_step"),
                stepId: z.string(),
              }),
              z.object({
                op: z.literal("connect"),
                fromStepId: z.string(),
                toStepId: z.string(),
                handle: z.string(),
              }),
            ]),
          )
          .min(1),
      }),
      execute: async (args) => {
        const patch = args as unknown as CopilotPatch;
        patchesRef.push(patch);
        return {
          ok: true,
          patchId: patchesRef.length - 1,
          opsCount: patch.ops.length,
          note: "Patch registrado. A UI vai mostrar pro operador aprovar ou descartar.",
        };
      },
    }),
  };

  return { tools, patchesRef };
}

export type CopilotMessage = {
  role: "user" | "assistant";
  content: string;
};

export type RunCopilotArgs = {
  currentAutomation: CopilotCurrentAutomation;
  messages: CopilotMessage[];
  model?: string;
  maxSteps?: number;
};

export type RunCopilotResult = {
  text: string;
  patches: CopilotPatch[];
  inputTokens: number;
  outputTokens: number;
  toolCallsCount: number;
};

export async function runAutomationCopilot(
  args: RunCopilotArgs,
): Promise<RunCopilotResult> {
  const { tools, patchesRef } = buildCopilotToolSet(args.currentAutomation);
  const history: ModelMessage[] = args.messages
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  const result = await generateWithAnthropic({
    model: args.model ?? DEFAULT_COPILOT_MODEL,
    system: SYSTEM_PROMPT,
    messages: history,
    tools,
    temperature: 0.3, // queremos determinismo/foco, não criatividade
    maxSteps: args.maxSteps ?? 12,
  });

  return {
    text: result.text,
    patches: patchesRef,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    toolCallsCount: result.toolCalls.length,
  };
}
