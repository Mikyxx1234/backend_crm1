import {
  Prisma,
  type ActivityType,
  type Contact,
  type Deal,
  type DealStatus,
  type LifecycleStage,
} from "@prisma/client";

import { normalizeConditionConfig } from "@/lib/automation-condition";
import { defaultDealTitleForContact } from "@/lib/display-name";
import { getLogger } from "@/lib/logger";
import {
  metaWhatsApp,
  metaClientFromConfig,
  formatMetaSendError,
  type MetaWhatsAppClient,
} from "@/lib/meta-whatsapp/client";
import { enrichTemplateComponentsForFlowSend } from "@/lib/meta-whatsapp/enrich-template-flow";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { getOrgIdOrNull, runWithActor } from "@/lib/request-context";
import type { AutomationJobPayload } from "@/lib/queue";
import { sseBus } from "@/lib/sse-bus";
import {
  assignDealOwner,
  createDealEvent,
  nextDealNumber,
  propagateOwnerToContactAndChat,
} from "@/services/deals";
import { triggerAgentOpeningForContact } from "@/services/ai/piloting-actions";
import { notifyDealStageChanged } from "@/services/automation-triggers";
import { updateContactScore } from "@/services/lead-scoring";
import { executeDistribution } from "@/services/distribution";
import { logEvent } from "@/services/activity-log";
import {
  createContext,
  advanceContext,
  getActiveContext,
  interpolateVariables,
} from "@/services/automation-context";
import { ensureWhatsAppConversationForContact } from "@/services/whatsapp-conversation";

const log = getLogger("automation");

/**
 * Resolve a conversa WhatsApp de DESTINO para um envio de automação (robô).
 *
 * Modelo de ticket (decisão do operador 17/jul/26): quando o robô envia uma
 * mensagem e a última conversa do contato está ENCERRADA (RESOLVED), a
 * conversa é REABERTA como um NOVO ticket (#N+1) — assim o card nunca fica
 * "resolvido com robô ativo". `ensureWhatsAppConversationForContact` já faz
 * isso: reusa a conversa não-RESOLVED ou cria um ticket novo (com tratamento
 * de corrida e disparo de `conversation_created`).
 *
 * Retorna `{ id } | null` de propósito, para manter compatível o uso
 * downstream (`conv?.id`, `conv.id`, `if (conv)`) dos sites de envio.
 * Fallback best-effort (sem canal/telefone): usa a conversa mais recente,
 * preservando o comportamento antigo.
 */
async function resolveAutomationSendConv(
  contactId: string | null | undefined,
): Promise<{ id: string } | null> {
  if (!contactId) return null;
  try {
    const ensured = await ensureWhatsAppConversationForContact(contactId);
    if ("conversationId" in ensured) return { id: ensured.conversationId };
  } catch (err) {
    log.warn(`resolveAutomationSendConv: ensure falhou p/ contato ${contactId}:`, err);
  }
  const conv = await prisma.conversation.findFirst({
    where: { contactId, channel: "whatsapp" },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return conv ? { id: conv.id } : null;
}

/**
 * Resolve o cliente Meta WhatsApp correto para uma automação multi-tenant.
 *
 * Estrategia:
 *   1. Se ja temos um `conversationId`, puxa `channelRef.config` da
 *      conversa — este eh o caminho preferencial pq garante 100% que o
 *      envio sai pelo canal certo da org corrente.
 *   2. Caso contrario (sem conv pra esse contato), procura o primeiro
 *      canal META_CLOUD_API ativo da org (via getOrgIdOrNull) — fallback
 *      pra triggers que disparam ANTES de existir conversa.
 *   3. Como ultimo recurso, usa o singleton global `metaWhatsApp` (env).
 *      Isso so deveria acontecer em ambientes legados sem canal cadastrado;
 *      logamos um warning para detectar.
 *
 * Antes (24/abr/26) o executor SEMPRE usava o singleton — automacoes da
 * org B saiam pelo numero da Eduit (env vars de uma org especifica). Bug
 * critico de multi-tenancy fixado aqui junto com o resto da Fase 1.
 */
async function resolveAutomationMetaClient(opts: {
  automationId?: string | null;
  conversationId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
}): Promise<MetaWhatsAppClient> {
  let resolvedOrgId: string | null = null;

  if (opts.conversationId) {
    const conv = await prisma.conversation.findUnique({
      where: { id: opts.conversationId },
      select: {
        organizationId: true,
        channelRef: { select: { config: true, provider: true } },
      },
    });
    resolvedOrgId = conv?.organizationId ?? null;
    const provider = conv?.channelRef?.provider;
    if (provider === "META_CLOUD_API") {
      const cfg = conv?.channelRef?.config as
        | Record<string, unknown>
        | null
        | undefined;
      const client = metaClientFromConfig(cfg);
      if (client.configured) return client;
    }
  }

  // Ordem de resolução do tenant quando não há RequestContext:
  // 1) ALS atual (rotas HTTP)
  // 2) deal -> org
  // 3) contact -> org
  // 4) automation -> org
  if (!resolvedOrgId) {
    resolvedOrgId = getOrgIdOrNull();
  }
  if (!resolvedOrgId && opts.dealId) {
    const deal = await prisma.deal.findUnique({
      where: { id: opts.dealId },
      select: { organizationId: true },
    });
    resolvedOrgId = deal?.organizationId ?? null;
  }
  if (!resolvedOrgId && opts.contactId) {
    const contact = await prisma.contact.findUnique({
      where: { id: opts.contactId },
      select: { organizationId: true },
    });
    resolvedOrgId = contact?.organizationId ?? null;
  }
  if (!resolvedOrgId && opts.automationId) {
    const automation = await prisma.automation.findUnique({
      where: { id: opts.automationId },
      select: { organizationId: true },
    });
    resolvedOrgId = automation?.organizationId ?? null;
  }

  if (resolvedOrgId) {
    const channel = await prisma.channel.findFirst({
      where: {
        organizationId: resolvedOrgId,
        provider: "META_CLOUD_API",
        status: "CONNECTED",
      },
      select: { config: true },
      orderBy: { createdAt: "asc" },
    });
    if (channel?.config) {
      const client = metaClientFromConfig(
        channel.config as Record<string, unknown>,
      );
      if (client.configured) return client;
    }
  }

  log.warn(
    `Nenhum canal META_CLOUD_API encontrado (automation=${opts.automationId ?? "—"}, conv=${opts.conversationId ?? "—"}, org=${resolvedOrgId ?? "—"}) — caindo para singleton (env vars). MULTI-TENANCY EM RISCO!`,
  );
  return metaWhatsApp;
}

const ACTIVITY_TYPES: ActivityType[] = ["CALL", "EMAIL", "MEETING", "TASK", "NOTE", "WHATSAPP", "OTHER"];
const LIFECYCLE_STAGES: LifecycleStage[] = ["SUBSCRIBER", "LEAD", "MQL", "SQL", "OPPORTUNITY", "CUSTOMER", "EVANGELIST", "OTHER"];

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function readNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────
// Webhook — interpolação de variáveis dotted-path no body/headers
//
// O step `webhook` aceita um `body` (string JSON) e `headers` custom com
// tokens `{{caminho.pontilhado}}` (ex.: `{{contact.name}}`,
// `{{contact.adCtwaClid}}`, `{{deal.id}}`, `{{event}}`, `{{timestamp}}`).
// Resolvemos cada token contra um root montado a partir do RuntimeContext
// e substituímos pelo valor escapado para JSON (sem aspas externas — o
// template já as fornece em `"{{...}}"`). Token ausente vira string vazia.
//
// Backward-compat: se `body` não for configurado, mantemos o payload
// legado `{ event, contactId, dealId, data }`.
// ─────────────────────────────────────────────────────────────────

function resolveDottedPath(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  let cur: unknown = root;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function webhookValueToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function jsonEscapeFragment(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

const WEBHOOK_TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

function interpolateWebhookString(template: string, root: Record<string, unknown>): string {
  return template.replace(WEBHOOK_TOKEN_RE, (_m, path: string) => {
    const val = resolveDottedPath(root, path);
    return jsonEscapeFragment(webhookValueToString(val));
  });
}

function buildWebhookRoot(rt: RuntimeContext): Record<string, unknown> {
  // 03/jun/26 — root expandido pra cobrir o que o construtor visual de
  // body do step `webhook` lista no catálogo (ver
  // `automation-webhook-variables.ts` no front). Antes só tinha
  // `contact`/`deal`/`event`/`data`, então tokens como `{{contactTagNames}}`,
  // `{{conversation.id}}` e `{{contactCustomFields.<nome>}}` apareciam na
  // UI mas resolviam pra string vazia. Mantemos os campos existentes
  // intactos pra não quebrar bodies salvos.
  return {
    event: rt.event,
    automationId: rt.automationId,
    timestamp: new Date().toISOString(),
    contactId: rt.contactId ?? null,
    dealId: rt.dealId ?? null,
    contact: rt.contact ?? null,
    deal: rt.deal ?? null,
    conversation: rt.conversation ?? null,
    data: rt.data ?? {},
    contactTagIds: rt.contactTagIds ?? [],
    contactTagNames: rt.contactTagNames ?? [],
    dealTagIds: rt.dealTagIds ?? [],
    dealTagNames: rt.dealTagNames ?? [],
    contactCustomFields: rt.contactCustomFields ?? {},
    dealCustomFields: rt.dealCustomFields ?? {},
  };
}

/**
 * Interpola tokens `{{...}}` de uma MENSAGEM de texto livre enviada ao
 * cliente (send_whatsapp_message, question, interactive).
 *
 * Diferente do `interpolateVariables` legado (que só aceita chaves planas
 * `[a-zA-Z0-9_]+` e mantém o literal `{{x}}` quando a variável não existe),
 * aqui usamos o MESMO root do Webhook (`buildWebhookRoot`) + as flow
 * variables, resolvendo caminhos com ponto (`contact.name`,
 * `contactCustomFields.cpf`, `conversation.id`, ...). Assim o atalho `[`
 * lista exatamente os mesmos campos do Webhook. Token ausente vira string
 * VAZIA — comportamento pedido pelo operador: "se o cliente não tem o
 * campo, envia vazio". Suporta o filtro `|first_name`.
 */
function interpolateContextVariables(
  template: string,
  rt: RuntimeContext,
  flowVars: Record<string, unknown> | undefined,
): string {
  const root: Record<string, unknown> = {
    ...buildWebhookRoot(rt),
    ...(flowVars ?? {}),
  };
  return template.replace(
    /\{\{\s*([\w.]+)(?:\s*\|\s*([a-zA-Z0-9_]+))?\s*\}\}/g,
    (_m, path: string, transform?: string) => {
      const value = webhookValueToString(resolveDottedPath(root, path));
      if (!transform) return value;
      const t = transform.trim().toLowerCase();
      if (t === "first" || t === "first_name" || t === "primeiro_nome") {
        return value.trim().split(/\s+/)[0] ?? "";
      }
      return value;
    },
  );
}

function readBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  const v = obj[key];
  if (typeof v === "boolean") return v;
  return undefined;
}

function isDealStatus(v: string): v is DealStatus {
  return v === "OPEN" || v === "WON" || v === "LOST";
}
function isActivityType(v: string): v is ActivityType {
  return ACTIVITY_TYPES.includes(v as ActivityType);
}
function isLifecycleStage(v: string): v is LifecycleStage {
  return LIFECYCLE_STAGES.includes(v as LifecycleStage);
}

async function logStep(args: {
  automationId: string;
  contactId?: string | null;
  dealId?: string | null;
  stepId?: string | null;
  stepType?: string | null;
  status: string;
  message: string;
  payload?: Record<string, unknown> | null;
  metaWebhookEventId?: string | null;
}) {
  const base = {
    automationId: args.automationId,
    contactId: args.contactId ?? null,
    dealId: args.dealId ?? null,
    status: args.status,
    message: args.message,
  };

  const payloadJson = args.payload ? (args.payload as Prisma.InputJsonValue) : undefined;
  const metaWebhookEventId = args.metaWebhookEventId ?? null;

  try {
    await prisma.automationLog.create({
      data: withOrgFromCtx({
        ...base,
        stepId: (args.stepId as string) ?? null,
        stepType: (args.stepType as string) ?? null,
        ...(payloadJson !== undefined ? { payload: payloadJson } : {}),
        ...(metaWebhookEventId ? { metaWebhookEventId } : {}),
      }),
    });
  } catch (firstErr) {
    try {
      await prisma.automationLog.create({
        data: withOrgFromCtx({
          ...base,
          ...(payloadJson !== undefined ? { payload: payloadJson } : {}),
          ...(metaWebhookEventId ? { metaWebhookEventId } : {}),
        }),
      });
    } catch (secondErr) {
      try {
        // Apos a migration multi-tenancy, "organizationId" e NOT NULL em
        // automation_logs. O fallback de fallback precisa injetar o orgId
        // do ctx; se nao houver ctx, melhor desistir e logar do que estourar
        // erro 500 numa rota que ja estava degradada.
        const orgId = getOrgIdOrNull();
        if (!orgId) {
          throw new Error(
            "logStep raw fallback sem organizationId no contexto",
          );
        }
        await prisma.$executeRawUnsafe(
          `INSERT INTO "automation_logs" ("id", "organizationId", "automationId", "contactId", "dealId", "status", "message", "executedAt")
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW())`,
          orgId,
          args.automationId,
          args.contactId ?? null,
          args.dealId ?? null,
          args.status,
          args.message,
        );
      } catch (rawErr) {
        log.error(
          `Falha ao gravar log no banco — primeira=${firstErr instanceof Error ? firstErr.message : firstErr} segunda=${secondErr instanceof Error ? secondErr.message : secondErr} raw=${rawErr instanceof Error ? rawErr.message : rawErr}`,
        );
      }
    }
  }
}

/**
 * Snapshot da conversa usada em conditions. Capturamos o snapshot aqui
 * pra o avaliador do `condition` poder comparar contra `conversation.status`,
 * `conversation.channel`, `conversation.isClosed` etc. — sem precisar
 * reconsultar o banco a cada regra.
 *
 * Atenção: `status` segue o enum `ConversationStatus` do Prisma (`OPEN`,
 * `RESOLVED`, `PENDING`, `SNOOZED`). O alias `isClosed` é `true` quando
 * `status === "RESOLVED"` — é o que o operador entende por "conversa
 * fechada" no produto.
 */
type ConversationSnapshot = {
  id: string;
  status: string;
  channel: string;
  isClosed: boolean;
  hasAgentReply: boolean;
  hasError: boolean;
  unreadCount: number;
  assignedToId: string | null;
};

/**
 * Deal + campos derivados (nome do estágio e do pipeline) — usamos nome
 * em vez de ID nas conditions por dois motivos: (1) evita que o operador
 * precise copiar/colar cuids no form, (2) sobrevive a recriação de
 * estágio/pipeline quando o nome é preservado. O ID continua disponível
 * (`deal.stageId`, `deal.pipelineId`) para quem preferir.
 */
type DealWithNames = Deal & {
  contactId: string | null;
  stageName: string;
  pipelineId: string;
  pipelineName: string;
};

type RuntimeContext = {
  automationId: string;
  /** Nome da automação em execução — usado como `senderName` nas
      mensagens postadas pelos steps, pra que a UI exiba a badge
      "AUTOMAÇÃO — <nome>" e o operador identifique qual regra
      disparou. `null`/undefined mantém fallback "Automação" no front. */
  automationName?: string | null;
  /** Nome do agente que disparou a automação MANUALMENTE (via /run). Quando
      presente, as mensagens enviadas pelos steps são tagueadas com
      `triggeredByName` — o inbox exibe o selo "Manual" + avatar do agente
      (colab) na própria mensagem enviada, sem card de status separado. */
  triggeredByName?: string | null;
  contactId?: string;
  dealId?: string;
  event: string;
  data: Record<string, unknown>;
  contact: Contact | null;
  deal: DealWithNames | null;
  conversation: ConversationSnapshot | null;
  // 27/mai/26 — Tags carregadas junto com contact/deal pra avaliação
  // de `has_tag`/`not_has_tag` nas conditions. Mantemos id e nome em
  // arrays paralelos pra suportar match por qualquer um dos dois (o
  // operador escolhe um nome no picker da UI; salvar por id continua
  // disponível pra retrocompat e robustez a renomes).
  contactTagIds: string[];
  contactTagNames: string[];
  dealTagIds: string[];
  dealTagNames: string[];
  // 03/jun/26 — Snapshot de custom fields do contato/negócio. Usado
  // pelo construtor visual do step `webhook` pra emitir tokens como
  // `{{contactCustomFields.<nome>}}`. Chave é o `name` (slug) do
  // CustomField; valor é o `String` armazenado em
  // `*_custom_field_values.value` (todos os tipos serializam pra
  // string no banco).
  contactCustomFields: Record<string, string>;
  dealCustomFields: Record<string, string>;
  /**
   * Profundidade de encadeamento herdada do job (anti-loop). Passos que
   * disparam gatilhos como efeito (mover etapa) propagam `depth+1` via
   * `notifyDealStageChanged`. Ver `AutomationJobContext.depth`.
   */
  depth: number;
};

/**
 * Carrega tags do contato e do deal em arrays paralelos (ids + nomes).
 *
 * Usado por `resolveRuntimeContext` (primeira execução) e por
 * `continueFromStep` (continuação após `wait_for_reply`/`question`),
 * além de ser invocado dentro do loop após cada `add_tag`/`remove_tag`
 * pra que a próxima `condition` enxergue o estado atualizado das tags.
 */
/**
 * Snapshot dos custom fields do contato e do negócio (chave = `name` do
 * CustomField, valor = string armazenada). Usado tanto na execução
 * inicial quanto em `continueFromStep` pra que o webhook tenha a versão
 * mais atual quando o operador montou um body que referencia
 * `{{contactCustomFields.celular_55}}`, `{{dealCustomFields.observacao}}`
 * etc. via construtor visual.
 *
 * Recarregamos depois de `update_field` (no loop principal) pra evitar
 * que um webhook subsequente envie a versão antiga.
 */
async function loadAutomationCustomFieldsSnapshot(
  contactId: string | undefined,
  dealId: string | undefined,
): Promise<{
  contactCustomFields: Record<string, string>;
  dealCustomFields: Record<string, string>;
}> {
  const contactCustomFields: Record<string, string> = {};
  const dealCustomFields: Record<string, string> = {};

  if (contactId) {
    const rows = await prisma.contactCustomFieldValue.findMany({
      where: { contactId },
      select: { value: true, customField: { select: { name: true } } },
    });
    for (const r of rows) {
      const name = r.customField?.name;
      if (name) contactCustomFields[name] = r.value ?? "";
    }
  }

  if (dealId) {
    const rows = await prisma.dealCustomFieldValue.findMany({
      where: { dealId },
      select: { value: true, customField: { select: { name: true } } },
    });
    for (const r of rows) {
      const name = r.customField?.name;
      if (name) dealCustomFields[name] = r.value ?? "";
    }
  }

  return { contactCustomFields, dealCustomFields };
}

async function loadAutomationTagSnapshot(
  contactId: string | undefined,
  dealId: string | undefined,
): Promise<{
  contactTagIds: string[];
  contactTagNames: string[];
  dealTagIds: string[];
  dealTagNames: string[];
}> {
  let contactTagIds: string[] = [];
  let contactTagNames: string[] = [];
  let dealTagIds: string[] = [];
  let dealTagNames: string[] = [];

  if (contactId) {
    const rows = await prisma.tagOnContact.findMany({
      where: { contactId },
      select: { tagId: true, tag: { select: { name: true } } },
    });
    contactTagIds = rows.map((r) => r.tagId);
    contactTagNames = rows
      .map((r) => r.tag?.name)
      .filter((n): n is string => typeof n === "string");
  }

  if (dealId) {
    const rows = await prisma.tagOnDeal.findMany({
      where: { dealId },
      select: { tagId: true, tag: { select: { name: true } } },
    });
    dealTagIds = rows.map((r) => r.tagId);
    dealTagNames = rows
      .map((r) => r.tag?.name)
      .filter((n): n is string => typeof n === "string");
  }

  return { contactTagIds, contactTagNames, dealTagIds, dealTagNames };
}

async function loadConversationSnapshot(
  contactId: string,
  payloadData: Record<string, unknown>,
): Promise<ConversationSnapshot | null> {
  // Quando o evento carrega um conversationId explícito (webhook da Meta,
  // SSE, etc.) preferimos essa conversa específica. Senão, pegamos a mais
  // recente do contato — é a que o operador vê como "atual" na inbox.
  const explicitId =
    typeof payloadData.conversationId === "string" ? payloadData.conversationId : null;

  const conv = explicitId
    ? await prisma.conversation.findUnique({
        where: { id: explicitId },
        select: {
          id: true,
          status: true,
          channel: true,
          hasAgentReply: true,
          hasError: true,
          unreadCount: true,
          assignedToId: true,
          contactId: true,
        },
      })
    : await prisma.conversation.findFirst({
        where: { contactId },
        orderBy: [{ updatedAt: "desc" }],
        select: {
          id: true,
          status: true,
          channel: true,
          hasAgentReply: true,
          hasError: true,
          unreadCount: true,
          assignedToId: true,
        },
      });

  if (!conv) return null;

  const statusStr = String(conv.status);
  return {
    id: conv.id,
    status: statusStr,
    channel: conv.channel,
    isClosed: statusStr === "RESOLVED",
    hasAgentReply: conv.hasAgentReply,
    hasError: conv.hasError,
    unreadCount: conv.unreadCount,
    assignedToId: conv.assignedToId,
  };
}

// Cache do check da coluna `messages.triggeredByName`. Em ambientes onde a
// migração ainda não rodou, tentar gravar a coluna faria o insert dos steps
// de envio quebrar (P2022). Só tagueamos o disparo manual quando a coluna
// existe — degradação graciosa (mensagem ainda é enviada, apenas sem o selo
// "Manual"/avatar do agente até a migração aplicar).
let _msgTriggeredByNameColumn: boolean | null = null;
async function messageSupportsTriggeredBy(): Promise<boolean> {
  if (_msgTriggeredByNameColumn !== null) return _msgTriggeredByNameColumn;
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'messages' AND column_name = 'triggeredByName'
      ) AS "exists"`;
    _msgTriggeredByNameColumn = Boolean(rows?.[0]?.exists);
  } catch {
    _msgTriggeredByNameColumn = false;
  }
  return _msgTriggeredByNameColumn;
}

async function resolveRuntimeContext(
  automationId: string,
  payload: AutomationJobPayload,
  automationName?: string | null,
): Promise<RuntimeContext | null> {
  const ctx = payload.context;
  const data = asRecord(ctx.data) ?? {};
  let contactId = ctx.contactId;
  let dealId = ctx.dealId;

  // Sem dealId explícito mas com contato (ex.: execução manual disparada
  // pela conversa, ou gatilhos de contato): resolve o negócio ABERTO mais
  // recente do contato pra que `{{deal.*}}` e os passos de negócio tenham
  // contexto. Mesmo padrão já usado por `consume_stock`/distribuição.
  if (!dealId && contactId) {
    const openDeal = await prisma.deal.findFirst({
      where: { contactId, status: "OPEN" },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (openDeal) dealId = openDeal.id;
  }

  let deal: DealWithNames | null = null;
  let dealTagIds: string[] = [];
  let dealTagNames: string[] = [];
  if (dealId) {
    const rawDeal = await prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        stage: { select: { name: true, pipelineId: true, pipeline: { select: { name: true } } } },
        // 27/mai/26 — Carrega tags do deal junto pra avaliação de
        // `has_tag` em conditions. Selecionamos só id+name pra não
        // inflar payload com color etc.
        tags: { select: { tagId: true, tag: { select: { name: true } } } },
      },
    });
    if (!rawDeal) {
      await logStep({ automationId, contactId, dealId, status: "FAILED", message: "Negócio não encontrado." });
      return null;
    }
    if (!contactId && rawDeal.contactId) contactId = rawDeal.contactId;
    const { stage, tags, ...dealOnly } = rawDeal;
    deal = {
      ...(dealOnly as Deal & { contactId: string | null }),
      stageName: stage?.name ?? "",
      pipelineId: stage?.pipelineId ?? "",
      pipelineName: stage?.pipeline?.name ?? "",
    };
    dealTagIds = tags.map((t) => t.tagId);
    dealTagNames = tags
      .map((t) => t.tag?.name)
      .filter((n): n is string => typeof n === "string");
  }

  let contact: Contact | null = null;
  let contactTagIds: string[] = [];
  let contactTagNames: string[] = [];
  if (contactId) {
    // Em vez de uma findUnique + uma segunda query pras tags, fazemos
    // uma única query com include — `Contact` no `rt` continua sendo
    // o tipo base do Prisma (tags são desestruturadas em campos
    // separados no RuntimeContext pra não vazar pro evalRoot quem não
    // quer).
    const rawContact = await prisma.contact.findUnique({
      where: { id: contactId },
      include: {
        tags: { select: { tagId: true, tag: { select: { name: true } } } },
      },
    });
    if (rawContact) {
      const { tags, ...contactOnly } = rawContact;
      contact = contactOnly as Contact;
      contactTagIds = tags.map((t) => t.tagId);
      contactTagNames = tags
        .map((t) => t.tag?.name)
        .filter((n): n is string => typeof n === "string");
    }
  }

  const conversation = contactId ? await loadConversationSnapshot(contactId, data) : null;

  const customFieldsSnapshot = await loadAutomationCustomFieldsSnapshot(
    contactId,
    dealId,
  );

  const rawTriggeredByName =
    typeof data.triggeredByName === "string" && data.triggeredByName.trim()
      ? data.triggeredByName.trim()
      : null;
  // Só propaga (e, portanto, grava nas mensagens) se a coluna existir.
  const triggeredByName =
    rawTriggeredByName && (await messageSupportsTriggeredBy())
      ? rawTriggeredByName
      : null;

  return {
    automationId,
    automationName: automationName ?? null,
    triggeredByName,
    contactId,
    dealId,
    event: ctx.event,
    data,
    contact,
    deal,
    conversation,
    contactTagIds,
    contactTagNames,
    dealTagIds,
    dealTagNames,
    contactCustomFields: customFieldsSnapshot.contactCustomFields,
    dealCustomFields: customFieldsSnapshot.dealCustomFields,
    depth: typeof ctx.depth === "number" ? ctx.depth : 0,
  };
}

function getByPath(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let cur: unknown = root;
  for (const p of parts) {
    const rec = asRecord(cur);
    if (!rec) return undefined;
    cur = rec[p];
  }
  return cur;
}

function coerceForCompare(
  left: unknown,
  right: unknown
): { l: unknown; r: unknown } {
  // `right` quase sempre vem do form como string. Se o `left` for
  // number e o `right` parecer número, converte pros dois serem number
  // — evita falsos negativos tipo "5" === 5.
  if (typeof left === "number" && typeof right === "string" && right.trim() !== "") {
    const n = Number(right);
    if (!Number.isNaN(n)) return { l: left, r: n };
  }
  if (typeof right === "number" && typeof left === "string" && left.trim() !== "") {
    const n = Number(left);
    if (!Number.isNaN(n)) return { l: n, r: right };
  }
  // Boolean vs string "true"/"false" — a UI salva o valor do `SelectNative`
  // como string, mas o runtime produz boolean real (ex. `conversation.isClosed`,
  // `conversation.hasError`). Normaliza para boolean dos dois lados.
  if (typeof left === "boolean" && typeof right === "string") {
    const s = right.trim().toLowerCase();
    if (s === "true" || s === "false") return { l: left, r: s === "true" };
  }
  if (typeof right === "boolean" && typeof left === "string") {
    const s = left.trim().toLowerCase();
    if (s === "true" || s === "false") return { l: s === "true", r: right };
  }
  // Strings → comparação case-insensitive pra `eq`/`ne`/`includes` é
  // tratada no switch; aqui só normalizo whitespace nas duas pontas.
  if (typeof left === "string" && typeof right === "string") {
    return { l: left.trim(), r: right.trim() };
  }
  return { l: left, r: right };
}

function evalCondition(leftRaw: unknown, op: string, rightRaw: unknown): boolean {
  const { l: left, r: right } = coerceForCompare(leftRaw, rightRaw);
  const lStr = typeof left === "string" ? left.toLowerCase() : left;
  const rStr = typeof right === "string" ? right.toLowerCase() : right;

  switch (op) {
    case "eq":
      if (typeof lStr === "string" && typeof rStr === "string") return lStr === rStr;
      return left === right;
    case "ne":
      if (typeof lStr === "string" && typeof rStr === "string") return lStr !== rStr;
      return left !== right;
    case "gt":
      return typeof left === "number" && typeof right === "number" && left > right;
    case "gte":
      return typeof left === "number" && typeof right === "number" && left >= right;
    case "lt":
      return typeof left === "number" && typeof right === "number" && left < right;
    case "lte":
      return typeof left === "number" && typeof right === "number" && left <= right;
    case "includes":
      if (typeof left === "string" && typeof right === "string")
        return left.toLowerCase().includes(right.toLowerCase());
      if (Array.isArray(left)) return left.includes(right);
      return false;
    case "starts_with":
      return typeof left === "string" && typeof right === "string"
        && left.toLowerCase().startsWith(right.toLowerCase());
    case "ends_with":
      return typeof left === "string" && typeof right === "string"
        && left.toLowerCase().endsWith(right.toLowerCase());
    case "empty":
      if (left == null) return true;
      if (typeof left === "string") return left.trim() === "";
      if (Array.isArray(left)) return left.length === 0;
      return false;
    case "not_empty":
      if (left == null) return false;
      if (typeof left === "string") return left.trim() !== "";
      if (Array.isArray(left)) return left.length > 0;
      return true;
    case "has_tag":
    case "not_has_tag": {
      // `left` é sempre um array (`contact.tags`, `contact.tagIds`,
      // `deal.tags`, `deal.tagIds`) — o evalRoot garante isso. `right`
      // pode ser nome OU id (a UI escolhe via picker, mas a checagem
      // case-insensitive contra ambos é resiliente). Se o lado esquerdo
      // não for array, devolvemos `false` (configuração inválida).
      if (!Array.isArray(left)) return op === "not_has_tag";
      const needle = typeof right === "string" ? right.trim().toLowerCase() : String(right ?? "").trim().toLowerCase();
      if (!needle) return op === "not_has_tag"; // value vazio = "sem tag escolhida" → trata como "nenhuma match"
      const haystack = left.map((v) => String(v ?? "").trim().toLowerCase());
      const hit = haystack.includes(needle);
      return op === "has_tag" ? hit : !hit;
    }
    default:
      return false;
  }
}

type StepResult = {
  skipRemaining?: boolean;
  gotoStepId?: string;
  setVariable?: { name: string; value: unknown };
};

async function executeStep(
  stepType: string,
  rawConfig: Prisma.JsonValue | Record<string, unknown>,
  rt: RuntimeContext
): Promise<StepResult> {
  const cfg = asRecord(rawConfig as Prisma.JsonValue) ?? {};

  switch (stepType) {
    case "send_email": {
      const to = readString(cfg, "to") ?? rt.contact?.email ?? "";
      const subject = readString(cfg, "subject") ?? "(sem assunto)";
      log.warn(`send_email: envio de e-mail não implementado (to=${to}, assunto="${subject}") — step ignorado`);
      return {};
    }

    case "move_stage":
    case "move_to_stage": {
      const stageId = readString(cfg, "stageId") ?? readString(cfg, "value");
      if (!stageId) throw new Error("move_stage: stageId obrigatório");
      let targetDealId = rt.dealId ?? readString(cfg, "dealId");
      if (!targetDealId && rt.contactId) {
        const openDeal = await prisma.deal.findFirst({
          where: { contactId: rt.contactId, status: "OPEN" },
          select: { id: true },
        });
        targetDealId = openDeal?.id;
      }
      if (!targetDealId) throw new Error("move_stage: dealId ausente no contexto");
      // Estágios terminais fixos (Ganho/Perdido) sincronizam Deal.status
      // — mesma regra do moveDeal manual no Kanban.
      const targetStage = await prisma.stage.findUnique({
        where: { id: stageId },
        select: { isWon: true, isLost: true },
      });
      const currentDeal = await prisma.deal.findUnique({
        where: { id: targetDealId },
        select: { status: true, stageId: true, contactId: true },
      });
      const statusPatch = targetStage?.isWon
        ? currentDeal?.status === "WON"
          ? {}
          : { status: "WON" as const, closedAt: new Date(), lostReason: null }
        : targetStage?.isLost
          ? currentDeal?.status === "LOST"
            ? {}
            : { status: "LOST" as const, closedAt: new Date() }
          : currentDeal?.status === "OPEN" || !currentDeal
            ? {}
            : { status: "OPEN" as const, closedAt: null, lostReason: null };
      await prisma.deal.update({ where: { id: targetDealId }, data: { stageId, ...statusPatch } });
      // Dispara "mudança de fase" (encadeado, com guarda anti-loop) pra que
      // automações "quando entra na fase X" também rodem quando OUTRA
      // automação move o negócio. Antes esse caminho não disparava nada.
      if (currentDeal?.stageId && currentDeal.stageId !== stageId) {
        void notifyDealStageChanged(targetDealId, currentDeal.stageId, stageId, {
          contactId: rt.contactId ?? currentDeal.contactId ?? undefined,
          depth: (rt.depth ?? 0) + 1,
        });
      }
      return {};
    }

    case "assign_owner": {
      const userId = readString(cfg, "userId");
      if (!userId) throw new Error("assign_owner: userId obrigatório");
      const target = readString(cfg, "target") ?? (rt.dealId ? "deal" : "contact");
      if (target === "deal") {
        const targetDealId = rt.dealId ?? readString(cfg, "dealId");
        if (!targetDealId) throw new Error("assign_owner: dealId ausente");
        // Responsável único: muda o owner do deal e propaga para o
        // contato + conversas do contato (helper no service).
        await assignDealOwner(targetDealId, userId);
      } else {
        const targetContactId = rt.contactId ?? readString(cfg, "contactId");
        if (!targetContactId) throw new Error("assign_owner: contactId ausente");
        // Mesma regra de herança do deal: ao atribuir pelo contato,
        // propagamos pras conversas abertas — isso é o que faz o agente
        // de IA assumir automaticamente quando o `userId` aponta pra um
        // User type=AI (`maybeReplyAsAIAgent` lê `conversation.assignedToId`).
        await prisma.$transaction((tx) =>
          propagateOwnerToContactAndChat(tx, targetContactId, userId),
        );
      }
      return {};
    }

    case "execute_distribution": {
      // Distribuição Inteligente como ação de automação. Funciona como um IF
      // (estilo n8n) de DUAS saídas, baseado em "havia agente disponível?":
      //   • SIM  → distribuiu com sucesso → segue o fluxo linear (nextStepId).
      //   • NÃO  → nenhum responsável elegível (ou módulo desabilitado) →
      //            roteia pro ramo `elseStepId` (handle "false" no canvas).
      // Usa SOMENTE o motor único (`executeDistribution`) — mesma regra da
      // tela/simulação. Quando NÃO há elegível, o motor já enfileira o lead
      // em `distribution_pending` (rede de segurança p/ redistribuir depois);
      // aqui só decidimos qual ramo do fluxo seguir. Não lançamos erro: a
      // ausência de agente é um resultado de negócio esperado, não falha.
      const distributionType = readString(cfg, "distributionType") ?? null;
      const conversationId =
        rt.conversation && typeof rt.conversation === "object"
          ? ((rt.conversation as { id?: string }).id ?? null)
          : null;

      const result = await executeDistribution({
        dealId: rt.dealId ?? null,
        contactId: rt.contactId ?? null,
        conversationId,
        triggerSource: "AUTOMATION",
        distributionType,
      });

      if (result.success) {
        // Saída SIM = fluxo linear (próximo passo).
        return {};
      }

      // Saída NÃO = sem agente elegível / módulo off. Roteia pro ramo "false".
      const elseStepId = readString(cfg, "elseStepId");
      if (elseStepId) {
        return { skipRemaining: true, gotoStepId: elseStepId };
      }
      // Sem ramo "Não" conectado: encerra este ramo (lead já foi enfileirado
      // pelo motor quando o motivo foi NO_ELIGIBLE_RESPONSIBLE).
      return { skipRemaining: true };
    }

    case "transfer_to_ai_agent": {
      // Passo dedicado de handoff: transfere a conversa/contato/deal para
      // um agente de IA. Debaixo do capô é um assign_owner apontando pra
      // User.type=AI, mas a UI do passo mostra só agentes IA ativos e
      // explica a mecânica. O runner `maybeReplyAsAIAgent` assume na
      // próxima mensagem inbound.
      const agentUserId = readString(cfg, "agentUserId");
      if (!agentUserId) {
        throw new Error("transfer_to_ai_agent: agentUserId obrigatório");
      }
      // Validação defensiva: confirmar que o alvo é mesmo um agente IA
      // ativo. Se o agente foi desativado ou deletado, logamos e
      // seguimos sem atribuir (melhor que estourar o fluxo).
      const agentUser = await prisma.user.findUnique({
        where: { id: agentUserId },
        select: {
          id: true,
          type: true,
          aiAgentConfig: { select: { active: true } },
        },
      });
      if (!agentUser || agentUser.type !== "AI") {
        log.warn(
          `transfer_to_ai_agent: usuário ${agentUserId} não é um agente IA — ignorando passo`,
        );
        return {};
      }
      if (!agentUser.aiAgentConfig?.active) {
        log.warn(
          `transfer_to_ai_agent: agente IA ${agentUserId} está inativo — ignorando passo`,
        );
        return {};
      }

      const target = readString(cfg, "target") ?? (rt.dealId ? "deal" : "contact");
      let contactForOpening: string | null = null;
      if (target === "deal") {
        const targetDealId = rt.dealId ?? readString(cfg, "dealId");
        if (!targetDealId) {
          throw new Error("transfer_to_ai_agent: dealId ausente");
        }
        await assignDealOwner(targetDealId, agentUserId);
        // Resolve o contact do deal pra poder disparar a saudação
        // proativa (precisa do contactId, não do dealId).
        const deal = await prisma.deal.findUnique({
          where: { id: targetDealId },
          select: { contactId: true },
        });
        contactForOpening = deal?.contactId ?? null;
      } else {
        const targetContactId = rt.contactId ?? readString(cfg, "contactId");
        if (!targetContactId) {
          throw new Error("transfer_to_ai_agent: contactId ausente");
        }
        await prisma.$transaction((tx) =>
          propagateOwnerToContactAndChat(tx, targetContactId, agentUserId),
        );
        contactForOpening = targetContactId;
      }

      // Saudação proativa: dispara imediatamente após a atribuição,
      // sem esperar o cliente mandar mensagem. Isso resolve o caso de
      // automações cujo trigger é "Negócio criado" / etc. — antes, o
      // agente ficava mudo porque `maybeReplyAsAIAgent` só roda em
      // inbound. Idempotente via `Conversation.aiGreetedAt`, então
      // se o cliente mandar algo depois, a saudação não repete.
      //
      // Falhas aqui não podem derrubar o passo da automação: o log do
      // passo já registrou "transfer_to_ai_agent OK". A saudação é
      // efeito colateral; se falhar, o agente ainda responderá ao
      // próximo inbound normalmente.
      if (contactForOpening) {
        try {
          const opening = await triggerAgentOpeningForContact({
            contactId: contactForOpening,
            agentUserId,
            channel: "meta",
          });
          if (opening.status === "skipped") {
            log.info(
              `transfer_to_ai_agent: saudação proativa pulada (${opening.reason})`,
            );
          } else {
            log.info(
              `transfer_to_ai_agent: saudação proativa ${opening.status} (conv=${opening.conversationId})`,
            );
          }
        } catch (err) {
          log.warn("transfer_to_ai_agent: falha na saudação proativa:", err);
        }
      }
      return {};
    }

    case "add_tag": {
      const targetContactId = rt.contactId ?? readString(cfg, "contactId");
      if (!targetContactId) throw new Error("add_tag: contactId ausente");
      const tagId = readString(cfg, "tagId");
      const tagName = readString(cfg, "tagName");
      let resolvedTagId = tagId;
      if (!resolvedTagId && tagName) {
        const orgId = getOrgIdOrNull();
        if (!orgId) throw new Error("add_tag: organizationId ausente do contexto");
        const tag = await prisma.tag.upsert({
          where: { organizationId_name: { organizationId: orgId, name: tagName } },
          create: withOrgFromCtx({ name: tagName }),
          update: {},
        });
        resolvedTagId = tag.id;
      }
      if (!resolvedTagId) throw new Error("add_tag: tagId ou tagName obrigatório");
      await prisma.tagOnContact.upsert({
        where: { contactId_tagId: { contactId: targetContactId, tagId: resolvedTagId } },
        create: { contactId: targetContactId, tagId: resolvedTagId },
        update: {},
      });

      // 27/mai/26 — Espelha a tag no deal aberto do contato (TagOnDeal)
      // pra que kanban e inbox mostrem a mesma tag. Antes, `add_tag` só
      // gravava `TagOnContact`: inbox exibia a tag (renderiza tags do
      // contato) mas o card do kanban não (renderiza tags do deal).
      // Operador relatou "no inbox aparece a TAG CLT, mas no kanban não".
      // Buscamos o deal aberto via `rt.dealId` quando presente, ou caímos
      // pro deal mais recente do contato — ambos best-effort.
      const targetDealId =
        rt.dealId ??
        (await prisma.deal
          .findFirst({
            where: { contactId: targetContactId, status: "OPEN" },
            select: { id: true },
            orderBy: { updatedAt: "desc" },
          })
          .then((d) => d?.id));
      if (targetDealId) {
        await prisma.tagOnDeal.upsert({
          where: { dealId_tagId: { dealId: targetDealId, tagId: resolvedTagId } },
          create: { dealId: targetDealId, tagId: resolvedTagId },
          update: {},
        });
      }
      return {};
    }

    case "remove_tag": {
      const targetContactId = rt.contactId ?? readString(cfg, "contactId");
      if (!targetContactId) throw new Error("remove_tag: contactId ausente");
      const tagId = readString(cfg, "tagId");
      const tagName = readString(cfg, "tagName");
      let resolvedTagId = tagId;
      if (!resolvedTagId && tagName) {
        const orgId = getOrgIdOrNull();
        if (orgId) {
          const tag = await prisma.tag.findUnique({
            where: { organizationId_name: { organizationId: orgId, name: tagName } },
          });
          if (tag) resolvedTagId = tag.id;
        }
      }
      if (resolvedTagId) {
        await prisma.tagOnContact.deleteMany({
          where: { contactId: targetContactId, tagId: resolvedTagId },
        });
        // Simétrico ao `add_tag`: remove também do deal aberto do
        // contato. Mantém inbox e kanban sincronizados.
        const targetDealId =
          rt.dealId ??
          (await prisma.deal
            .findFirst({
              where: { contactId: targetContactId, status: "OPEN" },
              select: { id: true },
              orderBy: { updatedAt: "desc" },
            })
            .then((d) => d?.id));
        if (targetDealId) {
          await prisma.tagOnDeal.deleteMany({
            where: { dealId: targetDealId, tagId: resolvedTagId },
          });
        }
      }
      return {};
    }

    case "update_field": {
      const entity = readString(cfg, "entity") ?? "contact";
      const field = readString(cfg, "field");
      if (!field) throw new Error("update_field: field obrigatório");
      const value = cfg["value"];

      if (entity === "deal") {
        const targetDealId = rt.dealId ?? readString(cfg, "dealId");
        if (!targetDealId) throw new Error("update_field: dealId ausente");
        const data: Prisma.DealUncheckedUpdateInput = {};
        if (field === "title" && typeof value === "string") data.title = value;
        else if (field === "value" && (typeof value === "number" || typeof value === "string")) {
          data.value = typeof value === "number" ? value : new Prisma.Decimal(String(value));
        } else if (field === "status" && typeof value === "string" && isDealStatus(value)) data.status = value;
        else if (field === "stageId" && typeof value === "string") data.stageId = value;
        if (Object.keys(data).length > 0) {
          // Se o update for de etapa, captura a etapa anterior ANTES pra
          // disparar "mudança de fase" depois (mesmo caminho do move_stage).
          const isStageMove = field === "stageId" && typeof value === "string";
          let prevStageId: string | null = null;
          let moveContactId: string | null = null;
          if (isStageMove) {
            const cur = await prisma.deal.findUnique({
              where: { id: targetDealId },
              select: { stageId: true, contactId: true },
            });
            prevStageId = cur?.stageId ?? null;
            moveContactId = cur?.contactId ?? null;
          }
          await prisma.deal.update({ where: { id: targetDealId }, data });
          if (isStageMove && prevStageId && prevStageId !== value) {
            void notifyDealStageChanged(targetDealId, prevStageId, value as string, {
              contactId: rt.contactId ?? moveContactId ?? undefined,
              depth: (rt.depth ?? 0) + 1,
            });
          }
        } else {
          const customField = await prisma.customField.findFirst({
            where: { entity: "deal", name: field },
            select: { id: true },
          });
          if (!customField) {
            throw new Error(`update_field: campo de negócio não suportado: ${field}`);
          }
          await prisma.dealCustomFieldValue.upsert({
            where: {
              dealId_customFieldId: {
                dealId: targetDealId,
                customFieldId: customField.id,
              },
            },
            update: { value: value == null ? "" : String(value) },
            create: withOrgFromCtx({
              dealId: targetDealId,
              customFieldId: customField.id,
              value: value == null ? "" : String(value),
            }),
          });
        }
      } else {
        const targetContactId = rt.contactId ?? readString(cfg, "contactId");
        if (!targetContactId) throw new Error("update_field: contactId ausente");
        const data: Prisma.ContactUncheckedUpdateInput = {};
        if (field === "name" && typeof value === "string") data.name = value;
        else if (field === "email" && (typeof value === "string" || value === null)) data.email = value as string | null;
        else if (field === "phone" && (typeof value === "string" || value === null)) data.phone = value as string | null;
        else if (field === "source" && (typeof value === "string" || value === null)) data.source = value as string | null;
        else if (field === "lifecycleStage" && typeof value === "string" && isLifecycleStage(value)) data.lifecycleStage = value;
        else if (field === "assignedToId" && (typeof value === "string" || value === null)) data.assignedToId = value as string | null;
        if (Object.keys(data).length > 0) {
          await prisma.contact.update({ where: { id: targetContactId }, data });
        } else {
          const customField = await prisma.customField.findFirst({
            where: { entity: "contact", name: field },
            select: { id: true },
          });
          if (!customField) {
            throw new Error(`update_field: campo de contato não suportado: ${field}`);
          }
          await prisma.contactCustomFieldValue.upsert({
            where: {
              contactId_customFieldId: {
                contactId: targetContactId,
                customFieldId: customField.id,
              },
            },
            update: { value: value == null ? "" : String(value) },
            create: withOrgFromCtx({
              contactId: targetContactId,
              customFieldId: customField.id,
              value: value == null ? "" : String(value),
            }),
          });
        }
      }
      return {};
    }

    case "create_activity": {
      const userId = readString(cfg, "userId") ??
        (await prisma.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
      if (!userId) throw new Error("create_activity: nenhum usuário disponível");
      const typeRaw = readString(cfg, "type") ?? "TASK";
      if (!isActivityType(typeRaw)) throw new Error("create_activity: tipo de atividade inválido");
      const title = readString(cfg, "title");
      if (!title) throw new Error("create_activity: title obrigatório");
      await prisma.activity.create({
        data: withOrgFromCtx({
          type: typeRaw,
          title,
          description: readString(cfg, "description") ?? null,
          userId,
          contactId: rt.contactId ?? null,
          dealId: rt.dealId ?? null,
          completed: readBoolean(cfg, "completed") ?? false,
        }),
      });
      return {};
    }

    case "send_whatsapp_message": {
      const cfgPhone = readString(cfg, "phone")?.trim() || "";
      const phoneRaw = cfgPhone || rt.contact?.phone || "";
      const digits = phoneRaw.replace(/\D/g, "");
      const to = digits.length >= 8 ? digits : undefined;
      const cfgRecipient = readString(cfg, "recipient")?.trim() || "";
      const recipient =
        cfgRecipient || rt.contact?.whatsappBsuid?.trim() || undefined;
      const contentRaw = readString(cfg, "content");
      const vars = (cfg as Record<string, unknown>)["__variables"] as Record<string, unknown> | undefined;
      const content = contentRaw
        ? interpolateContextVariables(contentRaw, rt, vars)
        : contentRaw;

      log.debug(`Enviando WhatsApp: contato=${rt.contactId ?? "—"} destino=${to ?? recipient ?? "—"} texto="${content?.slice(0, 60) ?? "(vazio)"}"`);

      if (!content) {
        throw new Error("send_whatsapp_message: content obrigatório (mensagem vazia)");
      }
      if (!to && !recipient) {
        throw new Error(
          `send_whatsapp_message: sem destino — contato não tem telefone nem BSUID. phone="${phoneRaw}" contactPhone="${rt.contact?.phone ?? "(null)"}"`
        );
      }

      let conversationId: string | undefined;
      if (rt.contactId) {
        const conv = await resolveAutomationSendConv(rt.contactId);
        conversationId = conv?.id;
        if (!conv) log.warn(`Nenhuma conversa WhatsApp encontrada para o contato ${rt.contactId}`);
      }

      const metaClient = await resolveAutomationMetaClient({
        automationId: rt.automationId,
        conversationId,
        contactId: rt.contactId ?? null,
        dealId: rt.dealId ?? null,
      });
      if (!metaClient.configured) {
        throw new Error(
          "send_whatsapp_message: nenhum canal META_CLOUD_API configurado para esta organização."
        );
      }

      let externalId: string | null = null;
      let sentContent = content;
      let msgType = "text";
      let outFlowToken: string | null = null;

      let hardFailure: Error | null = null;
      try {
        const result = await metaClient.sendText(to, content, recipient);
        externalId = result.messages?.[0]?.id ?? null;
      } catch (sendErr) {
        const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        const isSessionError = /131047|re-engage|session|window/i.test(errMsg);
        const fallbackTemplate = readString(cfg, "fallbackTemplateName");

        if (isSessionError && fallbackTemplate) {
          log.info(`Sessão de 24h expirada — caindo para template "${fallbackTemplate}"`);
          const langCode = readString(cfg, "fallbackLanguageCode") ?? "pt_BR";
          try {
            let fbGid: string | null = null;
            try {
              const r = await prisma.whatsAppTemplateConfig.findFirst({
                where: { metaTemplateName: fallbackTemplate },
                select: { metaTemplateId: true },
              });
              fbGid = r?.metaTemplateId?.trim() || null;
            } catch {
              /* ignore */
            }
            const fbEnrich = await enrichTemplateComponentsForFlowSend(metaClient, {
              templateName: fallbackTemplate,
              languageCode: langCode,
              components: undefined,
              templateGraphId: fbGid,
            });
            outFlowToken = fbEnrich.flowToken;
            const tplResult = await metaClient.sendTemplate(
              to,
              fallbackTemplate,
              langCode,
              fbEnrich.components,
              recipient,
            );
            externalId = tplResult?.messages?.[0]?.id ?? null;
            sentContent = `[Template fallback: ${fallbackTemplate}]`;
            msgType = "template";
          } catch (tplErr) {
            hardFailure = tplErr instanceof Error ? tplErr : new Error(String(tplErr));
          }
        } else {
          hardFailure = sendErr instanceof Error ? sendErr : new Error(String(sendErr));
        }
      }

      if (hardFailure) {
        log.error(`Envio WhatsApp falhou (contato=${rt.contactId ?? "—"}): ${hardFailure.message}`);

        // Registra a tentativa falha no chat pra o operador ver — senão
        // o erro só fica no AutomationLog e a conversa dá impressão de
        // que nada foi tentado.
        if (conversationId) {
          await prisma.message
            .create({
              data: withOrgFromCtx({
                conversationId,
                content,
                direction: "out",
                messageType: "text",
                senderName: rt.automationName ?? "Automação", authorType: "bot", ...(rt.triggeredByName ? { triggeredByName: rt.triggeredByName } : {}),
                sendStatus: "failed",
                sendError: formatMetaSendError(hardFailure).slice(0, 500),
              }),
            })
            .catch((err) => log.warn("Falha ao persistir mensagem de erro:", err));

          await prisma.conversation
            .update({
              where: { id: conversationId },
              data: { hasError: true, updatedAt: new Date() },
            })
            .catch(() => {});
        }

        throw hardFailure;
      }

      if (conversationId) {
        const saved = await prisma.message.create({
          data: withOrgFromCtx({
            conversationId,
            content: sentContent,
            direction: "out",
            messageType: msgType,
            senderName: rt.automationName ?? "Automação", authorType: "bot", ...(rt.triggeredByName ? { triggeredByName: rt.triggeredByName } : {}),
            externalId,
            ...(typeof outFlowToken === "string" && outFlowToken.trim()
              ? { flowToken: outFlowToken.trim() }
              : {}),
          }),
        });

        await prisma.conversation.update({
          where: { id: conversationId },
          data: { lastMessageDirection: "out", hasAgentReply: true, updatedAt: new Date() },
        }).catch(() => {});

        sseBus.publish("new_message", {
          organizationId: getOrgIdOrNull(),
          conversationId,
          contactId: rt.contactId,
          direction: "out",
          content: sentContent,
          timestamp: saved.createdAt,
        });
      }

      return {};
    }

    case "send_product": {
      const productId = readString(cfg, "productId")?.trim();
      if (!productId) throw new Error("send_product: productId obrigatório");

      // findFirst (não findUnique) para respeitar o escopo de org do
      // Prisma extension — evita vazar produto de outra organização.
      const product = await prisma.product.findFirst({
        where: { id: productId },
        select: { id: true, name: true, description: true, sku: true, price: true, unit: true },
      });
      if (!product) throw new Error(`send_product: produto ${productId} não encontrado`);

      const priceNumber = Number(product.price ?? 0);
      const priceLabel = `R$ ${priceNumber.toFixed(2).replace(".", ",")}`;
      const produtoVars = {
        produto: {
          nome: product.name ?? "",
          preco: priceLabel,
          preco_numero: priceNumber,
          sku: product.sku ?? "",
          descricao: product.description ?? "",
          unidade: product.unit ?? "",
        },
      };

      // Texto vazio → resumo padrão do produto. Texto preenchido → o operador
      // controla 100% do conteúdo, usando {{produto.*}} e variáveis de contexto.
      const contentRaw = readString(cfg, "content")?.trim();
      const content =
        contentRaw && contentRaw.length > 0
          ? contentRaw
          : [
              `*${product.name ?? "Produto"}*`,
              product.description ? product.description : null,
              `Valor: ${priceLabel}`,
            ]
              .filter(Boolean)
              .join("\n");

      const existingVars = asRecord((cfg as Record<string, unknown>)["__variables"]) ?? {};

      // Reaproveita TODO o fluxo de send_whatsapp_message (resolução de
      // conexão, envio Meta, fallback de template, persistência + SSE).
      return executeStep(
        "send_whatsapp_message",
        {
          ...cfg,
          content,
          __variables: { ...existingVars, ...produtoVars },
        },
        rt,
      );
    }

    case "send_whatsapp_template": {
      const cfgPhone = readString(cfg, "phone")?.trim() || "";
      const phoneRaw = cfgPhone || rt.contact?.phone || "";
      const digits = phoneRaw.replace(/\D/g, "");
      const to = digits.length >= 8 ? digits : undefined;
      const cfgRecipient = readString(cfg, "recipient")?.trim() || "";
      const recipient =
        cfgRecipient || rt.contact?.whatsappBsuid?.trim() || undefined;
      const templateName = readString(cfg, "templateName");
      const langCode = readString(cfg, "languageCode") ?? "pt_BR";
      log.debug(`Enviando template "${templateName}" (${langCode}) → ${to ?? recipient ?? "—"}`);
      if ((!to && !recipient) || !templateName) {
        throw new Error(`send_whatsapp_template: templateName obrigatório; to=${to ?? "—"} bsuid=${recipient ?? "—"} templateName=${templateName ?? "(vazio)"}`);
      }

      let preTplConversationId: string | undefined;
      if (rt.contactId) {
        const conv = await resolveAutomationSendConv(rt.contactId);
        preTplConversationId = conv?.id;
      }
      const tplMetaClient = await resolveAutomationMetaClient({
        automationId: rt.automationId,
        conversationId: preTplConversationId,
        contactId: rt.contactId ?? null,
        dealId: rt.dealId ?? null,
      });
      if (!tplMetaClient.configured) {
        throw new Error(
          "send_whatsapp_template: nenhum canal META_CLOUD_API configurado para esta organização."
        );
      }

      const rawComponents = Array.isArray(cfg["components"])
        ? (cfg["components"] as unknown[])
        : undefined;
      const flowToken = readString(cfg, "flowToken") ?? null;
      const fad = cfg["flowActionData"];
      const flowActionData =
        fad && typeof fad === "object" && !Array.isArray(fad)
          ? (fad as Record<string, unknown>)
          : null;
      let templateGraphId: string | null = null;
      try {
        const gidRow = await prisma.whatsAppTemplateConfig.findFirst({
          where: { metaTemplateName: templateName },
          select: { metaTemplateId: true },
        });
        templateGraphId = gidRow?.metaTemplateId?.trim() || null;
      } catch {
        /* ignore */
      }
      const enrichTpl = await enrichTemplateComponentsForFlowSend(tplMetaClient, {
        templateName,
        languageCode: langCode,
        components: rawComponents,
        flowToken,
        flowActionData,
        templateGraphId,
      });
      const tplResult = await tplMetaClient.sendTemplate(
        to,
        templateName,
        langCode,
        enrichTpl.components,
        recipient,
      );
      const tplExternalId = tplResult?.messages?.[0]?.id ?? null;

      let tplConversationId: string | undefined;
      if (rt.contactId) {
        const conv = await resolveAutomationSendConv(rt.contactId);
        tplConversationId = conv?.id;
      }

      if (tplConversationId) {
        let tplBodyPreview: string | null = null;
        // CRÍTICO: capturar `id` aqui é o que permite ao resolver de Flow
        // inbound identificar corretamente qual flow foi disparado pela
        // automação quando a resposta voltar pelo webhook.
        let tplConfigId: string | null = null;
        try {
          const tplCfg = await prisma.whatsAppTemplateConfig.findFirst({
            where: { metaTemplateName: templateName },
            select: { id: true, bodyPreview: true, category: true },
          });
          tplBodyPreview = tplCfg?.bodyPreview ?? null;
          tplConfigId = tplCfg?.id ?? null;
        } catch {}
        const tplContent = tplBodyPreview
          ? `📋 *${templateName}*\n\n${tplBodyPreview}`
          : `[Template: ${templateName}]`;

        const saved = await prisma.message.create({
          data: withOrgFromCtx({
            conversationId: tplConversationId,
            content: tplContent,
            direction: "out",
            messageType: "template",
            senderName: rt.automationName ?? "Automação", authorType: "bot", ...(rt.triggeredByName ? { triggeredByName: rt.triggeredByName } : {}),
            externalId: tplExternalId,
            ...(typeof enrichTpl.flowToken === "string" && enrichTpl.flowToken.trim()
              ? { flowToken: enrichTpl.flowToken.trim() }
              : {}),
            ...(tplConfigId ? { templateConfigId: tplConfigId } : {}),
          }),
        });

        await prisma.conversation.update({
          where: { id: tplConversationId },
          data: { lastMessageDirection: "out", hasAgentReply: true, updatedAt: new Date() },
        }).catch(() => {});

        sseBus.publish("new_message", {
          organizationId: getOrgIdOrNull(),
          conversationId: tplConversationId,
          contactId: rt.contactId,
          direction: "out",
          content: tplContent,
          timestamp: saved.createdAt,
        });
      }

      return {};
    }

    case "send_whatsapp_media": {
      const phoneRaw = readString(cfg, "phone")?.trim() || rt.contact?.phone || "";
      const digits = phoneRaw.replace(/\D/g, "");
      const to = digits.length >= 8 ? digits : undefined;
      const recipient = readString(cfg, "recipient")?.trim() || rt.contact?.whatsappBsuid?.trim() || undefined;
      if (!to && !recipient) throw new Error("send_whatsapp_media: sem destino");

      const mediaType = readString(cfg, "mediaType") ?? "image";
      const mediaUrl = readString(cfg, "mediaUrl");
      if (!mediaUrl) throw new Error("send_whatsapp_media: mediaUrl obrigatória");
      const caption = readString(cfg, "caption") ?? "";
      const filename = readString(cfg, "filename") ?? "";

      let preMediaConversationId: string | undefined;
      if (rt.contactId) {
        const conv = await resolveAutomationSendConv(rt.contactId);
        preMediaConversationId = conv?.id;
      }
      const mediaMetaClient = await resolveAutomationMetaClient({
        automationId: rt.automationId,
        conversationId: preMediaConversationId,
        contactId: rt.contactId ?? null,
        dealId: rt.dealId ?? null,
      });
      if (!mediaMetaClient.configured) {
        throw new Error(
          "send_whatsapp_media: nenhum canal META_CLOUD_API configurado para esta organização."
        );
      }

      let sendResult: { messages: Array<{ id: string }> };
      let displayContent: string;

      // PR 1.3: aceita tanto URLs novas (`/api/storage/...` tenant-scoped)
      // quanto legacy (`/uploads/...`). Se conseguirmos resolver localmente,
      // fazemos upload pra Meta via media id (evita expor URL pública).
      const { parseStoragePath, readStoredFile, mimeFromFilename } = await import(
        "@/lib/storage/local"
      );
      const parsedStorage = parseStoragePath(mediaUrl);
      const isLegacyLocal = !parsedStorage && mediaUrl.startsWith("/uploads/");
      const isLocalFile = Boolean(parsedStorage) || isLegacyLocal;

      if (isLocalFile) {
        let buffer: Buffer | null = null;
        let resolvedFileName: string;
        let mimeType: string;

        if (parsedStorage) {
          const stored = await readStoredFile(
            parsedStorage.orgId,
            parsedStorage.bucket,
            parsedStorage.fileName,
          );
          if (!stored) {
            throw new Error(`send_whatsapp_media: arquivo nao encontrado em storage (${mediaUrl})`);
          }
          buffer = stored.buffer;
          mimeType = stored.mimeType;
          resolvedFileName = parsedStorage.fileName;
        } else {
          const { readFile } = await import("fs/promises");
          const { join, basename } = await import("path");
          const filePath = join(process.cwd(), "public", mediaUrl);
          buffer = await readFile(filePath);
          resolvedFileName = basename(mediaUrl);
          mimeType = mimeFromFilename(resolvedFileName);
        }

        const fName = filename || resolvedFileName;
        const metaMediaId = await mediaMetaClient.uploadMedia(buffer, mimeType, fName);
        const mType = mediaType as "image" | "audio" | "video" | "document";
        sendResult = await mediaMetaClient.sendMediaById(to, metaMediaId, mType, caption || undefined, fName, false, recipient);
        displayContent = caption || fName || `[${mediaType}]`;
      } else {
        switch (mediaType) {
          case "video":
            sendResult = await mediaMetaClient.sendVideo(to, mediaUrl, caption || undefined, recipient);
            displayContent = caption || "[Vídeo]";
            break;
          case "audio":
            sendResult = await mediaMetaClient.sendAudio(to, mediaUrl, recipient);
            displayContent = "[Áudio]";
            break;
          case "document":
            sendResult = await mediaMetaClient.sendDocument(to, mediaUrl, filename || "documento", caption || undefined, recipient);
            displayContent = caption || filename || "[Documento]";
            break;
          default:
            sendResult = await mediaMetaClient.sendImage(to, mediaUrl, caption || undefined, recipient);
            displayContent = caption || "[Imagem]";
            break;
        }
      }

      const mediaExternalId = sendResult.messages?.[0]?.id ?? null;

      if (rt.contactId) {
        const conv = await resolveAutomationSendConv(rt.contactId);
        if (conv) {
          await prisma.message.create({
            data: withOrgFromCtx({
              conversationId: conv.id,
              content: displayContent,
              direction: "out",
              messageType: mediaType,
              senderName: rt.automationName ?? "Automação", authorType: "bot", ...(rt.triggeredByName ? { triggeredByName: rt.triggeredByName } : {}),
              externalId: mediaExternalId,
              mediaUrl,
            }),
          });
          sseBus.publish("new_message", {
            organizationId: getOrgIdOrNull(),
            conversationId: conv.id,
            contactId: rt.contactId,
            direction: "out",
            content: displayContent,
          });
        }
      }

      return {};
    }

    case "send_whatsapp_interactive": {
      const phoneRaw = readString(cfg, "phone")?.trim() || rt.contact?.phone || "";
      const digits = phoneRaw.replace(/\D/g, "");
      const to = digits.length >= 8 ? digits : undefined;
      const recipient = readString(cfg, "recipient")?.trim() || rt.contact?.whatsappBsuid?.trim() || undefined;
      if (!to && !recipient) throw new Error("send_whatsapp_interactive: sem destino");

      const interactiveVars = (cfg as Record<string, unknown>)["__variables"] as Record<string, unknown> | undefined;
      const bodyRaw = readString(cfg, "body");
      if (!bodyRaw) throw new Error("send_whatsapp_interactive: body obrigatório");
      const body = interpolateContextVariables(bodyRaw, rt, interactiveVars);

      const rawButtons = Array.isArray(cfg.buttons) ? cfg.buttons as { id?: string; title?: string; text?: string; gotoStepId?: string }[] : [];
      const buttons = rawButtons.slice(0, 3).map((b, i) => ({
        id: b.id || `btn_${i}`,
        title: (b.title || b.text || `Opção ${i + 1}`).slice(0, 20),
      }));
      if (buttons.length === 0) throw new Error("send_whatsapp_interactive: pelo menos 1 botão obrigatório");

      const headerRaw = readString(cfg, "header");
      const footerRaw = readString(cfg, "footer");
      const header = headerRaw ? interpolateContextVariables(headerRaw, rt, interactiveVars) : headerRaw;
      const footer = footerRaw ? interpolateContextVariables(footerRaw, rt, interactiveVars) : footerRaw;

      const btnLabels = buttons.map((b) => b.title).join(", ");
      const displayContent = `${body}\n[Botões: ${btnLabels}]`;

      let conversationId: string | undefined;
      if (rt.contactId) {
        const conv = await resolveAutomationSendConv(rt.contactId);
        conversationId = conv?.id;
      }

      const interactiveMetaClient = await resolveAutomationMetaClient({
        automationId: rt.automationId,
        conversationId,
        contactId: rt.contactId ?? null,
        dealId: rt.dealId ?? null,
      });
      if (!interactiveMetaClient.configured) {
        throw new Error(
          "send_whatsapp_interactive: nenhum canal META_CLOUD_API configurado para esta organização."
        );
      }

      let externalId: string | null = null;
      try {
        const sendResult = await interactiveMetaClient.sendInteractiveButtons(to, body, buttons, header, footer, recipient);
        externalId = sendResult.messages?.[0]?.id ?? null;
      } catch (sendErr) {
        const errMsg = formatMetaSendError(sendErr);
        log.error(`Envio WhatsApp interativo falhou (contato=${rt.contactId ?? "—"}): ${errMsg}`);
        if (conversationId) {
          await prisma.message
            .create({
              data: withOrgFromCtx({
                conversationId,
                content: displayContent,
                direction: "out",
                messageType: "interactive",
                senderName: rt.automationName ?? "Automação", authorType: "bot", ...(rt.triggeredByName ? { triggeredByName: rt.triggeredByName } : {}),
                sendStatus: "failed",
                sendError: errMsg.slice(0, 500),
              }),
            })
            .catch((err) => log.warn("Falha ao persistir mensagem interativa de erro:", err));
          await prisma.conversation
            .update({ where: { id: conversationId }, data: { hasError: true } })
            .catch(() => {});
        }
        throw sendErr instanceof Error ? sendErr : new Error(errMsg);
      }

      if (conversationId) {
        await prisma.message.create({
          data: withOrgFromCtx({
            conversationId,
            content: displayContent,
            direction: "out",
            messageType: "interactive",
            senderName: rt.automationName ?? "Automação", authorType: "bot", ...(rt.triggeredByName ? { triggeredByName: rt.triggeredByName } : {}),
            externalId,
            sendStatus: "sent",
          }),
        });
        sseBus.publish("new_message", {
          organizationId: getOrgIdOrNull(),
          conversationId,
          contactId: rt.contactId ?? undefined,
          direction: "out",
          content: displayContent,
        });
      }

      const stepId = (cfg as Record<string, unknown>).__stepId as string | undefined;
      const interactiveTimeoutMs = readNumber(cfg, "timeoutMs");
      if (stepId && rt.contactId) {
        const existingCtx = await getActiveContext(rt.automationId, rt.contactId);
        if (existingCtx) {
          await advanceContext(existingCtx.id, stepId, (existingCtx.variables as Record<string, unknown>) ?? {}, interactiveTimeoutMs);
        } else {
          await createContext(rt.automationId, rt.contactId, stepId, interactiveTimeoutMs);
        }
      }

      return { skipRemaining: true };
    }

    case "webhook": {
      const url = readString(cfg, "url");
      if (!url) throw new Error("webhook: url obrigatória");
      const method = (readString(cfg, "method") ?? "POST").toUpperCase();
      const headers = asRecord(cfg["headers"]) ?? {};

      // Root pra resolver os tokens {{...}} do body/headers custom.
      const root = buildWebhookRoot(rt);

      const h = new Headers({ "Content-Type": "application/json" });
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") h.set(k, interpolateWebhookString(v, root));
      }

      // Body custom (com variáveis) tem prioridade. Sem ele, payload legado.
      const customBody = readString(cfg, "body");
      let bodyStr: string | undefined;
      if (method === "GET" || method === "HEAD") {
        bodyStr = undefined;
      } else if (customBody && customBody.trim()) {
        bodyStr = interpolateWebhookString(customBody, root);
      } else {
        bodyStr = JSON.stringify({
          event: rt.event,
          contactId: rt.contactId ?? null,
          dealId: rt.dealId ?? null,
          data: rt.data,
        });
      }

      const res = await fetch(url, {
        method,
        headers: h,
        body: bodyStr,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`webhook: HTTP ${res.status}`);
      return {};
    }

    case "consume_stock":
    case "decrement_stock": {
      // Baixa de estoque OPT-IN: o operador adiciona este passo a uma
      // automação (ex.: gatilho `deal_won` ou entrada em estágio) para
      // reduzir o estoque dos produtos vinculados ao negócio. Só age em
      // produtos com `trackStock=true`. BLOQUEIA (lança erro) se faltar
      // estoque em qualquer item — não aplica baixa parcial nem deixa
      // o estoque negativo.
      let targetDealId = rt.dealId ?? readString(cfg, "dealId");
      if (!targetDealId && rt.contactId) {
        const openDeal = await prisma.deal.findFirst({
          where: { contactId: rt.contactId, status: "OPEN" },
          orderBy: { updatedAt: "desc" },
          select: { id: true },
        });
        targetDealId = openDeal?.id;
      }
      if (!targetDealId) throw new Error("consume_stock: dealId ausente no contexto");

      const items = await prisma.dealProduct.findMany({
        where: { dealId: targetDealId },
        select: {
          quantity: true,
          product: { select: { id: true, name: true, trackStock: true, stock: true } },
        },
      });

      const tracked = items.filter((it) => it.product.trackStock);
      if (tracked.length === 0) return {};

      // Pré-checagem de bloqueio: se algum produto não tem saldo, aborta
      // tudo antes de qualquer escrita.
      for (const it of tracked) {
        const need = Number(it.quantity);
        const have = Number(it.product.stock);
        if (have < need) {
          throw new Error(
            `consume_stock: estoque insuficiente para "${it.product.name}" (disponível ${have}, necessário ${need})`,
          );
        }
      }

      await prisma.$transaction(
        tracked.map((it) =>
          prisma.product.update({
            where: { id: it.product.id },
            data: { stock: { decrement: Number(it.quantity) } },
          }),
        ),
      );
      return {};
    }

    case "delay": {
      const ms = readNumber(cfg, "ms") ?? readNumber(cfg, "milliseconds") ?? 0;
      await new Promise((r) => setTimeout(r, Math.max(0, Math.floor(ms))));
      return {};
    }

    case "condition": {
      // Multi-branch (estilo Kommo): avalia cada branch em ordem. A
      // primeira branch cujas `rules` TODAS baterem (AND) dispara o
      // caminho `branch.nextStepId`. Se nenhuma bater, usa `elseStepId`.
      const flowVars = (cfg as Record<string, unknown>)["__variables"] as Record<string, unknown> | undefined;
      const evalRoot: Record<string, unknown> = {
        // 27/mai/26 — `tags` e `tagIds` expostos no evalRoot a partir
        // dos arrays carregados em `resolveRuntimeContext`. Os ops
        // `has_tag`/`not_has_tag` esperam encontrar arrays — se o
        // contato não tiver tags, fica `[]`, o que faz `has_tag`
        // retornar false (correto). Sobrescrevemos depois do spread
        // pra garantir que campos com mesmo nome do Prisma não vencem.
        contact: rt.contact
          ? { ...rt.contact, tags: rt.contactTagNames, tagIds: rt.contactTagIds }
          : { tags: rt.contactTagNames, tagIds: rt.contactTagIds },
        // `rt.deal` já carrega `stageName`, `pipelineId` e `pipelineName`
        // em runtime (ver `resolveRuntimeContext`). As versões "por ID"
        // ficam disponíveis pra retrocompatibilidade, e os novos campos
        // "por nome" são o caminho preferido nas novas conditions.
        deal: rt.deal
          ? { ...rt.deal, tags: rt.dealTagNames, tagIds: rt.dealTagIds }
          : { tags: rt.dealTagNames, tagIds: rt.dealTagIds },
        conversation: rt.conversation ?? null,
        data: rt.data,
        event: rt.event,
        variables: flowVars ?? {},
      };

      const conditionCfg = normalizeConditionConfig(cfg);
      for (const branch of conditionCfg.branches) {
        const allMatch = branch.rules.every((rule) => {
          let left = rule.field ? getByPath(evalRoot, rule.field) : undefined;

          // 27/mai/26 v2 — Para `has_tag`/`not_has_tag`, considera a
          // UNIÃO de tags de contato + deal independente do field
          // escolhido na UI (`contact.tags`, `deal.tags`, ou as versões
          // `.tagIds`). O step `add_tag` atual só persiste em
          // `TagOnContact`, então um operador que configura
          // `deal.tags has_tag "CLT"` esperando match na tag
          // recém-adicionada via fluxo nunca veria a condição bater.
          // União resolve o cenário-padrão sem exigir UI nova de
          // entity (contact vs deal) no step `add_tag`.
          if (
            (rule.op === "has_tag" || rule.op === "not_has_tag") &&
            (rule.field === "contact.tags" ||
              rule.field === "deal.tags" ||
              rule.field === "contact.tagIds" ||
              rule.field === "deal.tagIds")
          ) {
            const useIds = rule.field === "contact.tagIds" || rule.field === "deal.tagIds";
            left = useIds
              ? [...rt.contactTagIds, ...rt.dealTagIds]
              : [...rt.contactTagNames, ...rt.dealTagNames];
          }

          const rightRaw = rule.value;
          // Right pode ser string com {{variavel}} — interpola com as
          // flowVars antes de comparar.
          const right =
            typeof rightRaw === "string" && flowVars
              ? interpolateVariables(rightRaw, flowVars)
              : rightRaw;
          return evalCondition(left, rule.op, right);
        });
        if (allMatch) {
          if (branch.nextStepId) {
            return { skipRemaining: true, gotoStepId: branch.nextStepId };
          }
          // Branch bateu mas não tem destino — segue o fluxo linear.
          return {};
        }
      }

      // Nenhuma branch bateu.
      if (conditionCfg.elseStepId) {
        return { skipRemaining: true, gotoStepId: conditionCfg.elseStepId };
      }
      return { skipRemaining: true };
    }

    case "update_lead_score": {
      const targetContactId = rt.contactId ?? readString(cfg, "contactId");
      if (!targetContactId) throw new Error("update_lead_score: contactId ausente");
      await updateContactScore(targetContactId);
      return {};
    }

    case "question": {
      if (!rt.contactId) throw new Error("question: contactId ausente");
      const content = readString(cfg, "content") ?? readString(cfg, "message") ?? "";
      log.debug(`Pergunta ao contato ${rt.contactId}: "${content.slice(0, 60)}"`);
      if (content) {
        const phoneRaw = rt.contact?.phone ?? "";
        const digits = phoneRaw.replace(/\D/g, "");
        const to = digits.length >= 8 ? digits : undefined;
        const recipient = rt.contact?.whatsappBsuid?.trim() || undefined;
        if (to || recipient) {
          const vars = (cfg as Record<string, unknown>)["__variables"] as Record<string, unknown> | undefined;
          const interpolated = interpolateContextVariables(content, rt, vars);

          const conv = await resolveAutomationSendConv(rt.contactId);
          const questionMetaClient = await resolveAutomationMetaClient({
            automationId: rt.automationId,
            conversationId: conv?.id,
            contactId: rt.contactId ?? null,
            dealId: rt.dealId ?? null,
          });
          if (!questionMetaClient.configured) {
            throw new Error(
              "question: nenhum canal META_CLOUD_API configurado para esta organização."
            );
          }
          const sendResult = await questionMetaClient.sendText(to, interpolated, recipient);
          const externalId = sendResult.messages?.[0]?.id ?? null;
          if (conv) {
            await prisma.message.create({
              data: withOrgFromCtx({ conversationId: conv.id, content: interpolated, direction: "out", messageType: "text", senderName: rt.automationName ?? "Automação", authorType: "bot", ...(rt.triggeredByName ? { triggeredByName: rt.triggeredByName } : {}), externalId }),
            });
            sseBus.publish("new_message", { organizationId: getOrgIdOrNull(), conversationId: conv.id, contactId: rt.contactId, direction: "out", content: interpolated });
          }
        }
      }
      const questionStepId = (cfg as Record<string, unknown>).__stepId as string | undefined;
      const questionTimeoutMs = readNumber(cfg, "timeoutMs");
      if (questionStepId && rt.contactId) {
        const existingCtx = await getActiveContext(rt.automationId, rt.contactId);
        if (existingCtx) {
          await advanceContext(existingCtx.id, questionStepId, (existingCtx.variables as Record<string, unknown>) ?? {}, questionTimeoutMs);
        } else {
          await createContext(rt.automationId, rt.contactId, questionStepId, questionTimeoutMs);
        }
      }
      return { skipRemaining: true };
    }

    case "wait_for_reply": {
      if (!rt.contactId) throw new Error("wait_for_reply: contactId ausente");
      const wfrStepId = (cfg as Record<string, unknown>).__stepId as string | undefined;
      const wfrTimeoutMs = readNumber(cfg, "timeoutMs");
      if (wfrStepId) {
        const existingCtx = await getActiveContext(rt.automationId, rt.contactId);
        if (existingCtx) {
          await advanceContext(existingCtx.id, wfrStepId, (existingCtx.variables as Record<string, unknown>) ?? {}, wfrTimeoutMs);
        } else {
          await createContext(rt.automationId, rt.contactId, wfrStepId, wfrTimeoutMs);
        }
      }
      log.debug(`Aguardando resposta do contato ${rt.contactId}`);
      return { skipRemaining: true };
    }

    case "set_variable": {
      const varName = readString(cfg, "name") ?? readString(cfg, "variableName");
      if (!varName) throw new Error("set_variable: name obrigatório");
      let varValue: unknown = cfg["value"] ?? "";
      if (typeof varValue === "string") {
        const vars = (cfg as Record<string, unknown>)["__variables"] as Record<string, unknown> | undefined;
        if (vars) varValue = interpolateVariables(varValue, vars);
      }
      if (rt.contactId) {
        const existingCtx = await getActiveContext(rt.automationId, rt.contactId);
        if (existingCtx) {
          const ctxVars = { ...(existingCtx.variables as Record<string, unknown>), [varName]: varValue };
          await advanceContext(existingCtx.id, existingCtx.currentStepId, ctxVars);
        }
      }
      return { setVariable: { name: varName, value: varValue } };
    }

    case "goto": {
      const targetStepId = readString(cfg, "targetStepId") ?? readString(cfg, "nextStepId");
      if (!targetStepId) throw new Error("goto: targetStepId obrigatório");
      return { skipRemaining: true, gotoStepId: targetStepId };
    }

    case "transfer_automation": {
      const targetId = readString(cfg, "targetAutomationId");
      if (!targetId) throw new Error("transfer_automation: automação destino não definida");

      if (rt.contactId) {
        const existingCtx = await getActiveContext(rt.automationId, rt.contactId);
        if (existingCtx) {
          await advanceContext(existingCtx.id, null, (existingCtx.variables as Record<string, unknown>) ?? {});
        }
      }

      log.info(`Transferindo automação ${rt.automationId} → ${targetId}`);

      const transferPayload: AutomationJobPayload = {
        automationId: targetId,
        context: {
          event: rt.event,
          contactId: rt.contactId ?? undefined,
          dealId: rt.dealId ?? undefined,
          data: rt.data,
        },
      };

      setImmediate(() => {
        runAutomationInline(transferPayload).catch((err) => {
          log.error(`Falha ao executar automação de destino ${targetId}:`, err);
        });
      });

      return { skipRemaining: true };
    }

    case "stop_automation": {
      if (rt.contactId) {
        const existingCtx = await getActiveContext(rt.automationId, rt.contactId);
        if (existingCtx) {
          await advanceContext(existingCtx.id, null, (existingCtx.variables as Record<string, unknown>) ?? {});
        }
      }
      log.debug(`Automação ${rt.automationId} interrompida`);
      return { skipRemaining: true };
    }

    case "finish": {
      if (rt.contactId) {
        const existingCtx = await getActiveContext(rt.automationId, rt.contactId);
        if (existingCtx) {
          await advanceContext(existingCtx.id, null, (existingCtx.variables as Record<string, unknown>) ?? {});
        }
      }
      return { skipRemaining: true };
    }

    case "create_deal": {
      if (!rt.contactId) throw new Error("create_deal: contactId ausente");
      const stageId = readString(cfg, "stageId");
      if (!stageId) throw new Error("create_deal: stageId obrigatório");
      // Título opcional: sem config → "Negócio {contato}"; senão "Negócio - #n".
      let rawTitle = readString(cfg, "title")?.trim() ?? "";
      if (!rawTitle && rt.contactId) {
        const contact = await prisma.contact.findFirst({
          where: { id: rt.contactId },
          select: { name: true },
        });
        rawTitle = defaultDealTitleForContact(contact?.name) ?? "";
      }
      const rawValue = readNumber(cfg, "value");
      const stage = await prisma.stage.findUnique({
        where: { id: stageId },
        select: { name: true, pipelineId: true, pipeline: { select: { name: true } } },
      });
      if (!stage) throw new Error("create_deal: stageId inválido");
      // `Deal.number` e mandatorio + unico por org. Aloca max+1 com retry
      // em P2002 (corrida concorrente). Mesmo padrao de services/deals.ts.
      let deal: Deal | null = null;
      let lastErr: unknown;
      for (let attempt = 0; attempt < 5; attempt++) {
        const number = await nextDealNumber();
        const title = rawTitle || `Negócio - #${number}`;
        try {
          deal = await prisma.deal.create({
            data: withOrgFromCtx({
              number,
              title,
              contactId: rt.contactId,
              stageId,
              status: "OPEN" as const,
              ...(rawValue != null
                ? { value: new Prisma.Decimal(String(rawValue)) }
                : {}),
            }),
          });
          break;
        } catch (err) {
          lastErr = err;
          const isUnique =
            typeof err === "object" &&
            err !== null &&
            "code" in err &&
            (err as { code: string }).code === "P2002";
          if (!isUnique) throw err;
        }
      }
      if (!deal) {
        throw lastErr ?? new Error("Falha ao alocar Deal.number apos retries");
      }
      rt.dealId = deal.id;
      rt.deal = {
        ...(deal as Deal & { contactId: string | null }),
        stageName: stage.name,
        pipelineId: stage.pipelineId,
        pipelineName: stage.pipeline?.name ?? "",
      };
      return {};
    }

    case "finish_conversation": {
      if (!rt.contactId) return {};
      const convs = await prisma.conversation.findMany({
        where: { contactId: rt.contactId, status: { not: "RESOLVED" } },
        select: { id: true },
      });
      if (convs.length > 0) {
        await prisma.conversation.updateMany({
          where: { id: { in: convs.map((c) => c.id) } },
          data: { status: "RESOLVED" },
        });
      }
      return {};
    }

    case "ask_ai_agent": {
      // Chama um agente de IA com o prompt configurado (interpolando
      // variáveis) e salva a resposta como variável de contexto pra
      // usar nos próximos passos (ex: condition, send_whatsapp_message).
      const agentId = readString(cfg, "agentId");
      if (!agentId) throw new Error("ask_ai_agent: agentId não configurado");
      const promptTemplate = readString(cfg, "promptTemplate") ?? "";
      const variableName = readString(cfg, "saveToVariable") ?? "ai_response";

      const vars = (cfg as Record<string, unknown>)["__variables"] as
        | Record<string, unknown>
        | undefined;
      const prompt = vars
        ? interpolateVariables(promptTemplate, vars)
        : promptTemplate;
      if (!prompt.trim()) throw new Error("ask_ai_agent: prompt vazio");

      // import dinâmico pra evitar ciclo (runner → prisma → services).
      const { runAgent } = await import("@/services/ai/runner");
      const openDeal = rt.contactId
        ? await prisma.deal.findFirst({
            where: { contactId: rt.contactId, status: "OPEN" },
            orderBy: { updatedAt: "desc" },
            select: { id: true },
          })
        : null;
      const conv = rt.contactId
        ? await prisma.conversation.findFirst({
            where: { contactId: rt.contactId, channel: "whatsapp" },
            orderBy: { updatedAt: "desc" },
            select: { id: true },
          })
        : null;

      const result = await runAgent({
        agentId,
        source: "automation",
        userMessage: prompt,
        conversationId: conv?.id ?? null,
        contactId: rt.contactId ?? null,
        dealId: openDeal?.id ?? null,
      });
      if (result.status === "FAILED") {
        throw new Error(`ask_ai_agent: ${result.error ?? "falha no agente"}`);
      }

      // Persiste a variável no contexto da automation (mesma lógica
      // usada por `set_variable`).
      if (rt.contactId) {
        const ctx = await getActiveContext(rt.automationId, rt.contactId);
        if (ctx) {
          const next = { ...((ctx.variables as Record<string, unknown>) ?? {}) };
          next[variableName] = result.text;
          await advanceContext(ctx.id, ctx.currentStepId, next);
        }
      }
      return {};
    }

    case "business_hours": {
      const schedule = Array.isArray(cfg.schedule) ? cfg.schedule as { days: number[]; from: string; to: string }[] : [];
      const tz = readString(cfg, "timezone") ?? "America/Sao_Paulo";
      const now = new Date();
      const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" });
      const parts = formatter.formatToParts(now);
      const hh = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
      const mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
      const dayName = parts.find((p) => p.type === "weekday")?.value ?? "";
      const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const dayOfWeek = dayMap[dayName] ?? now.getDay();
      const nowMinutes = hh * 60 + mm;
      let isOpen = false;
      for (const slot of schedule) {
        if (!slot.days?.includes(dayOfWeek)) continue;
        const [fh, fm] = (slot.from ?? "00:00").split(":").map(Number);
        const [th, tm] = (slot.to ?? "23:59").split(":").map(Number);
        const fromMin = fh * 60 + fm;
        const toMin = th * 60 + tm;
        if (nowMinutes >= fromMin && nowMinutes <= toMin) { isOpen = true; break; }
      }
      if (!isOpen) {
        const elseStepId = readString(cfg, "elseStepId");
        if (elseStepId) return { skipRemaining: true, gotoStepId: elseStepId };
        return { skipRemaining: true };
      }
      return {};
    }

    case "inventory.adjust":
    case "inventory_adjust": {
      // Ajuste de alocação via ledger novo (InventoryPool). Reusa o service
      // `inventory.ts` (transacional/auditado). NÃO toca o estoque legado
      // (`consume_stock`). Operações: consume | restock | reserve | release.
      // Resolve o pool por `poolId` explícito ou por `productId` (pool global).
      // `consume`/`reserve` lançam InsufficientInventoryError sem saldo —
      // o erro propaga e marca o passo como falho (bloqueante).
      const operation = (readString(cfg, "operation") ?? "consume").toLowerCase();
      const qty = Math.max(
        1,
        Math.floor(readNumber(cfg, "qty") ?? readNumber(cfg, "quantity") ?? 1),
      );

      let poolId = readString(cfg, "poolId");
      if (!poolId) {
        const productId = readString(cfg, "productId");
        if (!productId) {
          throw new Error("inventory.adjust: informe poolId ou productId");
        }
        const globalPool = await prisma.inventoryPool.findFirst({
          where: { productId, orgUnitId: null },
          select: { id: true },
        });
        const anyPool =
          globalPool ??
          (await prisma.inventoryPool.findFirst({
            where: { productId },
            select: { id: true },
          }));
        if (!anyPool) {
          throw new Error("inventory.adjust: nenhum pool encontrado para o produto");
        }
        poolId = anyPool.id;
      }

      const dealId = rt.dealId ?? readString(cfg, "dealId") ?? null;
      const inv = await import("@/services/inventory");
      if (operation === "restock") {
        await inv.restock({ poolId, qty, dealId, note: "Automação: reposição" });
      } else if (operation === "release") {
        await inv.release({ poolId, qty, dealId });
      } else if (operation === "reserve") {
        await inv.reserve({ poolId, qty, dealId });
      } else {
        await inv.consume({
          poolId,
          qty,
          reason: "SALE",
          dealId,
          note: "Automação: consumo",
        });
      }
      return {};
    }

    case "allocation.adjust":
    case "allocation_adjust": {
      // Passo agnóstico do catálogo por capacidades (PRD). Roteia pelo service
      // `allocation.ts` (fachada de inventory.ts) para que o alerta de saldo
      // baixo dispare. Operações: adjust (delta assinado) | consume | restock |
      // reserve | release. Resolve o pool por poolId ou productId (pool global).
      const operation = (readString(cfg, "operation") ?? "adjust").toLowerCase();

      let poolId = readString(cfg, "poolId");
      if (!poolId) {
        const productId = readString(cfg, "productId");
        if (!productId) {
          throw new Error("allocation.adjust: informe poolId ou productId");
        }
        const globalPool = await prisma.inventoryPool.findFirst({
          where: { productId, orgUnitId: null },
          select: { id: true },
        });
        const anyPool =
          globalPool ??
          (await prisma.inventoryPool.findFirst({
            where: { productId },
            select: { id: true },
          }));
        if (!anyPool) {
          throw new Error("allocation.adjust: nenhum pool encontrado para o produto");
        }
        poolId = anyPool.id;
      }

      const dealId = rt.dealId ?? readString(cfg, "dealId") ?? null;
      const alloc = await import("@/services/allocation");

      if (operation === "adjust") {
        const delta = Math.floor(readNumber(cfg, "delta") ?? 0);
        if (delta === 0) throw new Error("allocation.adjust: delta não pode ser 0");
        await alloc.adjust({ poolId, delta, dealId, note: "Automação: ajuste" });
        return {};
      }

      const qty = Math.max(
        1,
        Math.floor(readNumber(cfg, "qty") ?? readNumber(cfg, "quantity") ?? 1),
      );
      if (operation === "restock") {
        await alloc.restock({ poolId, qty, dealId, note: "Automação: reposição" });
      } else if (operation === "release") {
        await alloc.release({ poolId, qty, dealId });
      } else if (operation === "reserve") {
        await alloc.reserve({ poolId, qty, dealId });
      } else {
        await alloc.consume({
          poolId,
          qty,
          reason: "SALE",
          dealId,
          note: "Automação: consumo",
        });
      }
      return {};
    }

    case "stakeholder.notify":
    case "stakeholder_notify": {
      // Passo agnóstico: avalia StakeholderRule do produto para um evento e
      // notifica os papéis casados (PRD: capability stakeholders).
      const productId = readString(cfg, "productId");
      if (!productId) throw new Error("stakeholder.notify: informe productId");
      const event = readString(cfg, "event") ?? "STAGE_ENTERED";
      const subjectName = readString(cfg, "subjectName") ?? "Atualização";
      const processLabel = readString(cfg, "processLabel") ?? "Processo";
      const dealId = rt.dealId ?? readString(cfg, "dealId") ?? null;
      const svc = await import("@/services/stakeholder-notify");
      await svc.evaluateStakeholderRules({
        productId,
        event,
        subjectName,
        processLabel,
        dealId,
      });
      return {};
    }

    default:
      throw new Error(`Tipo de passo desconhecido: ${stepType}`);
  }
}

const WA_SEND_STEP_TYPES = new Set([
  "send_whatsapp_message",
  "send_whatsapp_template",
  "send_whatsapp_media",
  "send_whatsapp_interactive",
  "send_product",
  "question",
]);

const DEFAULT_TYPING_DELAY_MS = 2000;

function readHumanizeSettings(triggerConfig: unknown): {
  markAsRead: boolean;
  simulateTyping: boolean;
  typingDelayMs: number;
} {
  const tc = asRecord(triggerConfig) ?? {};
  return {
    markAsRead: tc.markAsRead === true,
    simulateTyping: tc.simulateTyping === true,
    typingDelayMs:
      typeof tc.typingDelayMs === "number" && tc.typingDelayMs > 0
        ? tc.typingDelayMs
        : DEFAULT_TYPING_DELAY_MS,
  };
}

async function getLastInboundWamid(contactId: string): Promise<string | null> {
  const conv = await prisma.conversation.findFirst({
    where: { contactId, channel: "whatsapp" },
    select: { id: true },
  });
  if (!conv) return null;
  const msg = await prisma.message.findFirst({
    where: { conversationId: conv.id, direction: "in", externalId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { externalId: true },
  });
  return msg?.externalId ?? null;
}

async function humanizeBeforeStep(
  stepType: string,
  humanize: { markAsRead: boolean; simulateTyping: boolean; typingDelayMs: number },
  wamid: string | null,
  metaClient: MetaWhatsAppClient
): Promise<void> {
  if (!WA_SEND_STEP_TYPES.has(stepType) || !wamid || !metaClient.configured) return;
  if (humanize.simulateTyping) {
    try {
      await metaClient.sendTypingIndicator(wamid);
      await new Promise((r) => setTimeout(r, humanize.typingDelayMs));
    } catch (err) {
      log.debug("Indicador de digitação falhou:", err instanceof Error ? err.message : err);
    }
  }
}

export async function runAutomationInline(payload: AutomationJobPayload): Promise<void> {
  const { automationId, context } = payload;
  const traceId = `at-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  log.debug(`▶ ${traceId} ${automationId} evento=${context.event} contato=${context.contactId ?? "—"}`);

  let automation;
  try {
    automation = await prisma.automation.findUnique({
      where: { id: automationId },
      include: { steps: { orderBy: { position: "asc" } } },
    });
  } catch (dbErr) {
    log.error(`[${traceId}] Erro ao carregar automação:`, dbErr);
    await logStep({ automationId, contactId: context.contactId, dealId: context.dealId, status: "FAILED", message: `Erro ao carregar automação` });
    return;
  }

  if (!automation) {
    await logStep({ automationId, contactId: context.contactId, dealId: context.dealId, status: "FAILED", message: `Automação não encontrada` });
    return;
  }

  if (!automation.active) {
    await logStep({ automationId, contactId: context.contactId, dealId: context.dealId, status: "SKIPPED", message: `Automação inativa` });
    return;
  }

  const humanize = readHumanizeSettings(automation.triggerConfig);

  const contact = context.contactId
    ? await prisma.contact.findUnique({ where: { id: context.contactId }, select: { name: true, phone: true } })
    : null;
  const contactLabel = contact
    ? `${contact.name ?? "Contato"}${contact.phone ? ` (${contact.phone})` : ""}`
    : "—";

  const contextData = typeof context.data === "object" && context.data !== null
    ? context.data as Record<string, unknown>
    : {};

  const wamid =
    (typeof contextData.waMessageId === "string" ? contextData.waMessageId : null) ||
    (context.contactId ? await getLastInboundWamid(context.contactId) : null);

  let runConvIdForMeta: string | undefined;
  if (context.contactId) {
    const c = await prisma.conversation.findFirst({
      where: { contactId: context.contactId, channel: "whatsapp" },
      select: { id: true },
    });
    runConvIdForMeta = c?.id;
  }
  const runMetaClient = await resolveAutomationMetaClient({
    automationId,
    conversationId: runConvIdForMeta,
    contactId: context.contactId ?? null,
    dealId: context.dealId ?? null,
  });

  if (humanize.markAsRead && wamid && runMetaClient.configured) {
    try {
      await runMetaClient.markAsRead(wamid);
    } catch (err) {
      log.debug("Falha ao marcar mensagem como lida:", err instanceof Error ? err.message : err);
    }
  }

  const metaWebhookEventId =
    typeof contextData.metaWebhookEventId === "string"
      ? contextData.metaWebhookEventId
      : null;

  await logStep({
    automationId,
    contactId: context.contactId,
    dealId: context.dealId,
    status: "STARTED",
    message: `${contactLabel} — ${context.event === "message_received" ? "mensagem recebida" : context.event}`,
    payload: {
      evento: context.event,
      contato: contact?.name ?? "Contato",
      telefone: contact?.phone ?? undefined,
      ...(contextData.content ? { mensagem: String(contextData.content).slice(0, 200) } : {}),
      ...(contextData.channel ? { canal: contextData.channel } : {}),
    },
    metaWebhookEventId,
  });

  const rt = await resolveRuntimeContext(automationId, payload, automation.name);
  if (!rt) {
    await logStep({ automationId, contactId: context.contactId, dealId: context.dealId, status: "FAILED", message: `Contato ou negócio não encontrado` });
    return;
  }

  // A partir daqui qualquer escrita feita por executeStep/createDealEvent/
  // logEvent eh imputada a AUTOMATION (label = nome da automacao). Antes
  // ficava como SYSTEM ou herdava o ator do disparador (webhook/UI), o
  // que confundia o feed (mostrava o user humano que enviou a mensagem
  // como autor da troca de stage feita pelo bot).
  await runWithActor(
    {
      type: "AUTOMATION",
      label: automation.name,
      ref: automation.id,
    },
    async () => {

  let stepsFailed = 0;
  const stepById = new Map(automation.steps.map((s) => [s.id, s]));
  const NONE_ID = "__none__";
  const MAX_ITER = automation.steps.length * 2 + 10;

  let current: typeof automation.steps[0] | undefined = automation.steps[0];
  let iterations = 0;
  let flowVariables: Record<string, unknown> = {};

  while (current && iterations < MAX_ITER) {
    iterations++;
    const step = current;
    const stepLabel = STEP_TYPE_LABELS[step.type] ?? step.type;
    const stepConfig = step.config as Record<string, unknown>;
    const enrichedConfig = { ...stepConfig, __stepId: step.id, __variables: flowVariables };
    const { __rfPos: _, __stepId: _s, nextStepId: _n, __hasExplicitEdges: _e, ...cleanConfig } = stepConfig;

    await humanizeBeforeStep(step.type, humanize, wamid, runMetaClient);

    let result: StepResult;
    try {
      result = await executeStep(step.type, enrichedConfig, rt);
      if (result.setVariable) {
        flowVariables = { ...flowVariables, [result.setVariable.name]: result.setVariable.value };
        rt.data = { ...rt.data, ...flowVariables };
      }
      // 27/mai/26 — Refresh das tags no `rt` após add_tag/remove_tag pra
      // que conditions subsequentes (no MESMO fluxo, sem wait_for_reply
      // no meio) enxerguem o estado atualizado. Antes o snapshot vinha
      // de `resolveRuntimeContext` e ficava stale, fazendo `has_tag`
      // sempre retornar false.
      if (step.type === "add_tag" || step.type === "remove_tag") {
        const snap = await loadAutomationTagSnapshot(rt.contactId, rt.dealId);
        rt.contactTagIds = snap.contactTagIds;
        rt.contactTagNames = snap.contactTagNames;
        rt.dealTagIds = snap.dealTagIds;
        rt.dealTagNames = snap.dealTagNames;
      }
      // 03/jun/26 — Mesmo motivo das tags: se um `update_field` mudou
      // um custom field (de contato ou negócio), um webhook subsequente
      // que use `{{contactCustomFields.<x>}}` precisa enxergar o valor
      // atualizado. Recarregamos só os custom fields (tags não mudam
      // aqui) pra evitar query desnecessária.
      if (step.type === "update_field") {
        const snap = await loadAutomationCustomFieldsSnapshot(
          rt.contactId,
          rt.dealId,
        );
        rt.contactCustomFields = snap.contactCustomFields;
        rt.dealCustomFields = snap.dealCustomFields;
      }
      await logStep({
        automationId,
        contactId: rt.contactId,
        dealId: rt.dealId,
        stepId: step.id,
        stepType: step.type,
        status: "SUCCESS",
        message: `${stepLabel} — OK`,
        payload: cleanConfig,
      });
      if (result.skipRemaining && !result.gotoStepId) break;
    } catch (err) {
      stepsFailed++;
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`[${traceId}] Falha no step "${step.type}":`, msg);
      await logStep({
        automationId,
        contactId: rt.contactId,
        dealId: rt.dealId,
        stepId: step.id,
        stepType: step.type,
        status: "FAILED",
        message: `${stepLabel} — ${msg}`,
        payload: cleanConfig,
      });
      break;
    }

    if (result.gotoStepId && stepById.has(result.gotoStepId)) {
      current = stepById.get(result.gotoStepId);
      continue;
    }

    const nid = typeof stepConfig.nextStepId === "string" ? stepConfig.nextStepId : null;
    if (nid === NONE_ID) break;
    if (nid && stepById.has(nid)) {
      current = stepById.get(nid);
    } else if (nid) {
      // nextStepId aponta pra step inexistente (foi apagado): para o fluxo
      // ao invés de cair na ordem da array (que poderia disparar passos
      // de outros ramos por engano).
      log.warn(`[${traceId}] Step "${step.type}" tem nextStepId=${nid} inválido — fim de fluxo`);
      break;
    } else {
      // Sem nextStepId definido: fallback linear é seguro só na primeira
      // execução (passos antigos pré-migration). Para evitar surpresas em
      // ramos paralelos, só cai pro próximo da array se o passo está em
      // posição linear (ainda não foi alvo de connect explícito).
      const hasExplicitEdges = stepConfig.__hasExplicitEdges === true;
      if (hasExplicitEdges) {
        log.debug(`[${traceId}] Step "${step.type}" sem nextStepId e __hasExplicitEdges — fim de ramo`);
        break;
      }
      const idx = automation.steps.indexOf(step);
      current = idx >= 0 ? automation.steps[idx + 1] : undefined;
    }
  }

  const status = stepsFailed > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
  await logStep({
    automationId,
    contactId: rt.contactId,
    dealId: rt.dealId,
    status,
    message: stepsFailed > 0
      ? `${contactLabel} — finalizada com erros (${automation.steps.length} passos)`
      : `${contactLabel} — finalizada com sucesso (${automation.steps.length} passos)`,
  });

  if (rt.dealId) {
    createDealEvent(rt.dealId, null, "AUTOMATION_EXECUTED", {
      automationId,
      automationName: automation.name,
      event: context.event,
      stepsTotal: automation.steps.length,
      stepsFailed,
      status,
    }).catch(() => {});
  } else if (rt.contactId) {
    // Sem deal: ainda registramos no feed (/logs) pra dar visibilidade da
    // execução — importante para automações manuais disparadas pela conversa.
    logEvent({
      type: "AUTOMATION_EXECUTED",
      entityType: "CONTACT",
      entityId: rt.contactId,
      entityLabel: automation.name,
      contactId: rt.contactId,
      conversationId: rt.conversation?.id ?? null,
      meta: {
        automationId,
        automationName: automation.name,
        event: context.event,
        stepsTotal: automation.steps.length,
        stepsFailed,
        status,
      },
    }).catch(() => {});
  }

  // Disparo manual: NÃO postamos mais um card de status ("executada...") no
  // chat. As próprias mensagens enviadas pelos steps já são tagueadas com
  // `triggeredByName` (via withOrgFromCtx acima), então o inbox as exibe com
  // o selo "Manual" + avatar do agente que acionou (colab) — reproduzindo a
  // mensagem enviada, sem log redundante. Runs sem envio ao cliente ficam
  // visíveis apenas no activity log (AUTOMATION_EXECUTED).
    },
  );
}

const STEP_TYPE_LABELS: Record<string, string> = {
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
  send_product: "Enviar produto",
  webhook: "Webhook",
  delay: "Atraso",
  condition: "Condição",
  update_lead_score: "Lead score",
  question: "Pergunta ao lead",
  wait_for_reply: "Aguardar resposta",
  set_variable: "Definir variável",
  goto: "Ir para",
  finish: "Finalizar fluxo",
  create_deal: "Criar negócio",
  finish_conversation: "Encerrar conversa",
  business_hours: "Horário comercial",
  execute_distribution: "Executar distribuição",
};

export async function continueFromStep(
  automationId: string,
  contactId: string,
  fromStepId: string,
  variables: Record<string, unknown>
): Promise<void> {
  const automation = await prisma.automation.findUnique({
    where: { id: automationId },
    include: { steps: { orderBy: { position: "asc" } } },
  });
  if (!automation || !automation.active) return;

  const humanize = readHumanizeSettings(automation.triggerConfig);

  const fromIndex = automation.steps.findIndex((s) => s.id === fromStepId);
  if (fromIndex < 0) return;

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) return;
  const contactLabel = contact
    ? `${contact.name ?? "Contato"}${contact.phone ? ` (${contact.phone})` : ""}`
    : contactId;

  const dealRaw = await prisma.deal.findFirst({
    where: { contactId, status: "OPEN" },
    orderBy: { updatedAt: "desc" },
    include: {
      stage: { select: { name: true, pipelineId: true, pipeline: { select: { name: true } } } },
    },
  });
  const deal: DealWithNames | null = dealRaw
    ? (() => {
        const { stage, ...dealOnly } = dealRaw;
        return {
          ...(dealOnly as Deal & { contactId: string | null }),
          stageName: stage?.name ?? "",
          pipelineId: stage?.pipelineId ?? "",
          pipelineName: stage?.pipeline?.name ?? "",
        };
      })()
    : null;

  const conversation = await loadConversationSnapshot(contactId, variables);

  // 27/mai/26 — Carrega tags do contato e do deal pra que as conditions
  // com `has_tag`/`not_has_tag` enxerguem o estado atual. Antes,
  // `continueFromStep` montava o `rt` sem esses arrays e a condition
  // sempre caía no else (operador relatou: "selecionei CLT, condição
  // veio depois e foi ignorada").
  const tagSnapshot = await loadAutomationTagSnapshot(contactId, deal?.id);
  const customFieldsSnapshot = await loadAutomationCustomFieldsSnapshot(
    contactId,
    deal?.id,
  );

  const rt: RuntimeContext = {
    automationId,
    automationName: automation.name,
    contactId,
    dealId: deal?.id,
    event: "continue",
    data: variables,
    contact,
    deal,
    conversation,
    contactTagIds: tagSnapshot.contactTagIds,
    contactTagNames: tagSnapshot.contactTagNames,
    dealTagIds: tagSnapshot.dealTagIds,
    dealTagNames: tagSnapshot.dealTagNames,
    contactCustomFields: customFieldsSnapshot.contactCustomFields,
    dealCustomFields: customFieldsSnapshot.dealCustomFields,
    // Continuação após wait/question: mantém profundidade base (0). O
    // encadeamento relevante ocorre no fluxo principal (executeStep).
    depth: 0,
  };

  let contConvIdForMeta: string | undefined;
  {
    const c = await prisma.conversation.findFirst({
      where: { contactId, channel: "whatsapp" },
      select: { id: true },
    });
    contConvIdForMeta = c?.id;
  }
  const contMetaClient = await resolveAutomationMetaClient({
    automationId,
    conversationId: contConvIdForMeta,
    contactId,
    dealId: deal?.id ?? null,
  });

  const wamidForRead = await getLastInboundWamid(contactId);
  if (humanize.markAsRead && wamidForRead && contMetaClient.configured) {
    try {
      await contMetaClient.markAsRead(wamidForRead);
    } catch (err) {
      log.debug("Falha ao marcar mensagem como lida (continuação):", err instanceof Error ? err.message : err);
    }
  }

  await logStep({
    automationId,
    contactId,
    dealId: deal?.id,
    status: "STARTED",
    message: `${contactLabel} — continuando fluxo`,
  });

  // Continuacao tambem roda como AUTOMATION (mesmo motivo do runAutomationInline).
  await runWithActor(
    { type: "AUTOMATION", label: automation.name, ref: automation.id },
    async () => {

  const stepById = new Map(automation.steps.map((s) => [s.id, s]));
  const NONE_ID = "__none__";
  const MAX_ITER = automation.steps.length * 2 + 10;

  let current: typeof automation.steps[0] | undefined = automation.steps[fromIndex];
  let iterations = 0;
  let flowVariables: Record<string, unknown> = { ...variables };

  while (current && iterations < MAX_ITER) {
    iterations++;
    const step = current;
    const stepLabel = STEP_TYPE_LABELS[step.type] ?? step.type;
    const stepConfig = {
      ...(step.config as Record<string, unknown>),
      __stepId: step.id,
      __variables: flowVariables,
    };

    const wamid = await getLastInboundWamid(contactId);
    await humanizeBeforeStep(step.type, humanize, wamid, contMetaClient);

    let result: StepResult;
    try {
      result = await executeStep(step.type, stepConfig, rt);
      if (result.setVariable) {
        flowVariables = { ...flowVariables, [result.setVariable.name]: result.setVariable.value };
        rt.data = { ...rt.data, ...flowVariables };
      }
      if (step.type === "add_tag" || step.type === "remove_tag") {
        const snap = await loadAutomationTagSnapshot(rt.contactId, rt.dealId);
        rt.contactTagIds = snap.contactTagIds;
        rt.contactTagNames = snap.contactTagNames;
        rt.dealTagIds = snap.dealTagIds;
        rt.dealTagNames = snap.dealTagNames;
      }
      if (step.type === "update_field") {
        const snap = await loadAutomationCustomFieldsSnapshot(
          rt.contactId,
          rt.dealId,
        );
        rt.contactCustomFields = snap.contactCustomFields;
        rt.dealCustomFields = snap.dealCustomFields;
      }
      await logStep({
        automationId,
        contactId,
        dealId: deal?.id,
        stepId: step.id,
        stepType: step.type,
        status: "SUCCESS",
        message: `${stepLabel} — OK`,
      });
      if (result.skipRemaining && !result.gotoStepId) break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logStep({
        automationId,
        contactId,
        dealId: deal?.id,
        stepId: step.id,
        stepType: step.type,
        status: "FAILED",
        message: `${stepLabel} — ${msg}`,
      });
      break;
    }

    if (result.gotoStepId && stepById.has(result.gotoStepId)) {
      current = stepById.get(result.gotoStepId);
      continue;
    }

    const baseCfg = step.config as Record<string, unknown>;
    const nid = typeof baseCfg.nextStepId === "string" ? baseCfg.nextStepId : null;
    if (nid === NONE_ID) break;
    if (nid && stepById.has(nid)) {
      current = stepById.get(nid);
    } else if (nid) {
      log.warn(`continueFromStep: step "${step.type}" tem nextStepId=${nid} inválido — fim`);
      break;
    } else {
      // Sem nextStepId: continueFromStep está no meio de um ramo
      // (chegou aqui via wait_for_reply/question/buttons). Cair pra
      // automation.steps[idx+1] aqui pode disparar o passo do RAMO
      // VIZINHO por engano — então só seguimos se o step estiver
      // explicitamente sem __hasExplicitEdges (legado pré-migration).
      const hasExplicitEdges = baseCfg.__hasExplicitEdges === true;
      if (hasExplicitEdges) break;
      const idx = automation.steps.indexOf(step);
      current = idx >= 0 ? automation.steps[idx + 1] : undefined;
    }
  }

  await logStep({
    automationId,
    contactId,
    dealId: deal?.id,
    status: "COMPLETED",
    message: `${contactLabel} — finalizada com sucesso`,
  });

  if (deal?.id) {
    createDealEvent(deal.id, null, "AUTOMATION_EXECUTED", {
      automationId,
      automationName: automation.name,
      event: "continue",
      stepsTotal: automation.steps.length,
      status: "COMPLETED",
    }).catch(() => {});
  }
    },
  );
}
