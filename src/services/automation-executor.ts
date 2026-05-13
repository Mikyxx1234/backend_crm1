import {
  Prisma,
  type ActivityType,
  type Contact,
  type Deal,
  type DealStatus,
  type LifecycleStage,
} from "@prisma/client";

import { normalizeConditionConfig } from "@/lib/automation-condition";
import { getLogger } from "@/lib/logger";
import { metaWhatsApp, formatMetaSendError } from "@/lib/meta-whatsapp/client";
import { prisma } from "@/lib/prisma";
import type { AutomationJobPayload } from "@/lib/queue";
import { sseBus } from "@/lib/sse-bus";
import {
  assignDealOwner,
  createDealEvent,
  propagateOwnerToContactAndChat,
} from "@/services/deals";
import { updateContactScore } from "@/services/lead-scoring";
import {
  createContext,
  advanceContext,
  getActiveContext,
  interpolateVariables,
} from "@/services/automation-context";

const log = getLogger("automation");

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
}) {
  const base = {
    automationId: args.automationId,
    contactId: args.contactId ?? null,
    dealId: args.dealId ?? null,
    status: args.status,
    message: args.message,
  };

  const payloadJson = args.payload ? (args.payload as Prisma.InputJsonValue) : undefined;

  try {
    await prisma.automationLog.create({
      data: {
        ...base,
        stepId: (args.stepId as string) ?? null,
        stepType: (args.stepType as string) ?? null,
        ...(payloadJson !== undefined ? { payload: payloadJson } : {}),
      },
    });
  } catch (firstErr) {
    try {
      await prisma.automationLog.create({
        data: { ...base, ...(payloadJson !== undefined ? { payload: payloadJson } : {}) },
      });
    } catch (secondErr) {
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "automation_logs" ("id", "automationId", "contactId", "dealId", "status", "message", "executedAt")
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
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
  contactId?: string;
  dealId?: string;
  event: string;
  data: Record<string, unknown>;
  contact: Contact | null;
  deal: DealWithNames | null;
  conversation: ConversationSnapshot | null;
};

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

async function resolveRuntimeContext(
  automationId: string,
  payload: AutomationJobPayload
): Promise<RuntimeContext | null> {
  const ctx = payload.context;
  const data = asRecord(ctx.data) ?? {};
  let contactId = ctx.contactId;
  const dealId = ctx.dealId;

  let deal: DealWithNames | null = null;
  if (dealId) {
    const rawDeal = await prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        stage: { select: { name: true, pipelineId: true, pipeline: { select: { name: true } } } },
      },
    });
    if (!rawDeal) {
      await logStep({ automationId, contactId, dealId, status: "FAILED", message: "Negócio não encontrado." });
      return null;
    }
    if (!contactId && rawDeal.contactId) contactId = rawDeal.contactId;
    const { stage, ...dealOnly } = rawDeal;
    deal = {
      ...(dealOnly as Deal & { contactId: string | null }),
      stageName: stage?.name ?? "",
      pipelineId: stage?.pipelineId ?? "",
      pipelineName: stage?.pipeline?.name ?? "",
    };
  }

  let contact: Contact | null = null;
  if (contactId) contact = await prisma.contact.findUnique({ where: { id: contactId } });

  const conversation = contactId ? await loadConversationSnapshot(contactId, data) : null;

  return { automationId, contactId, dealId, event: ctx.event, data, contact, deal, conversation };
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
      await prisma.deal.update({ where: { id: targetDealId }, data: { stageId } });
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
      if (target === "deal") {
        const targetDealId = rt.dealId ?? readString(cfg, "dealId");
        if (!targetDealId) {
          throw new Error("transfer_to_ai_agent: dealId ausente");
        }
        await assignDealOwner(targetDealId, agentUserId);
      } else {
        const targetContactId = rt.contactId ?? readString(cfg, "contactId");
        if (!targetContactId) {
          throw new Error("transfer_to_ai_agent: contactId ausente");
        }
        await prisma.$transaction((tx) =>
          propagateOwnerToContactAndChat(tx, targetContactId, agentUserId),
        );
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
        const tag = await prisma.tag.upsert({ where: { name: tagName }, create: { name: tagName }, update: {} });
        resolvedTagId = tag.id;
      }
      if (!resolvedTagId) throw new Error("add_tag: tagId ou tagName obrigatório");
      await prisma.tagOnContact.upsert({
        where: { contactId_tagId: { contactId: targetContactId, tagId: resolvedTagId } },
        create: { contactId: targetContactId, tagId: resolvedTagId },
        update: {},
      });
      return {};
    }

    case "remove_tag": {
      const targetContactId = rt.contactId ?? readString(cfg, "contactId");
      if (!targetContactId) throw new Error("remove_tag: contactId ausente");
      const tagId = readString(cfg, "tagId");
      const tagName = readString(cfg, "tagName");
      let resolvedTagId = tagId;
      if (!resolvedTagId && tagName) {
        const tag = await prisma.tag.findUnique({ where: { name: tagName } });
        if (tag) resolvedTagId = tag.id;
      }
      if (resolvedTagId) {
        await prisma.tagOnContact.deleteMany({
          where: { contactId: targetContactId, tagId: resolvedTagId },
        });
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
        else throw new Error(`update_field: campo de negócio não suportado: ${field}`);
        if (Object.keys(data).length > 0) await prisma.deal.update({ where: { id: targetDealId }, data });
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
        else throw new Error(`update_field: campo de contato não suportado: ${field}`);
        await prisma.contact.update({ where: { id: targetContactId }, data });
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
        data: {
          type: typeRaw, title,
          description: readString(cfg, "description") ?? null,
          userId,
          contactId: rt.contactId ?? null,
          dealId: rt.dealId ?? null,
          completed: readBoolean(cfg, "completed") ?? false,
        },
      });
      return {};
    }

    case "send_whatsapp_message": {
      if (!metaWhatsApp.configured) {
        throw new Error(
          "send_whatsapp_message: Meta WhatsApp API não configurada (META_WHATSAPP_ACCESS_TOKEN / META_WHATSAPP_PHONE_NUMBER_ID ausentes)"
        );
      }

      const cfgPhone = readString(cfg, "phone")?.trim() || "";
      const phoneRaw = cfgPhone || rt.contact?.phone || "";
      const digits = phoneRaw.replace(/\D/g, "");
      const to = digits.length >= 8 ? digits : undefined;
      const cfgRecipient = readString(cfg, "recipient")?.trim() || "";
      const recipient =
        cfgRecipient || rt.contact?.whatsappBsuid?.trim() || undefined;
      const content = readString(cfg, "content");

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
        const conv = await prisma.conversation.findFirst({
          where: { contactId: rt.contactId, channel: "whatsapp" },
          select: { id: true },
        });
        conversationId = conv?.id;
        if (!conv) log.warn(`Nenhuma conversa WhatsApp encontrada para o contato ${rt.contactId}`);
      }

      let externalId: string | null = null;
      let sentContent = content;
      let msgType = "text";

      let hardFailure: Error | null = null;
      try {
        const result = await metaWhatsApp.sendText(to, content, recipient);
        externalId = result.messages?.[0]?.id ?? null;
      } catch (sendErr) {
        const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        const isSessionError = /131047|re-engage|session|window/i.test(errMsg);
        const fallbackTemplate = readString(cfg, "fallbackTemplateName");

        if (isSessionError && fallbackTemplate) {
          log.info(`Sessão de 24h expirada — caindo para template "${fallbackTemplate}"`);
          const langCode = readString(cfg, "fallbackLanguageCode") ?? "pt_BR";
          try {
            const tplResult = await metaWhatsApp.sendTemplate(to, fallbackTemplate, langCode, undefined, recipient);
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
              data: {
                conversationId,
                content,
                direction: "out",
                messageType: "text",
                senderName: "Automação",
                sendStatus: "failed",
                sendError: formatMetaSendError(hardFailure).slice(0, 500),
              },
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
          data: {
            conversationId,
            content: sentContent,
            direction: "out",
            messageType: msgType,
            senderName: "Automação",
            externalId,
          },
        });

        await prisma.conversation.update({
          where: { id: conversationId },
          data: { lastMessageDirection: "out", hasAgentReply: true, updatedAt: new Date() },
        }).catch(() => {});

        sseBus.publish("new_message", {
          conversationId,
          contactId: rt.contactId,
          direction: "out",
          content: sentContent,
          timestamp: saved.createdAt,
        });
      }

      return {};
    }

    case "send_whatsapp_template": {
      if (!metaWhatsApp.configured) {
        throw new Error("send_whatsapp_template: Meta WhatsApp API não configurada");
      }
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
      const components = cfg["components"] as unknown[] | undefined;
      const tplResult = await metaWhatsApp.sendTemplate(to, templateName, langCode, components, recipient);
      const tplExternalId = tplResult?.messages?.[0]?.id ?? null;

      let tplConversationId: string | undefined;
      if (rt.contactId) {
        const conv = await prisma.conversation.findFirst({
          where: { contactId: rt.contactId, channel: "whatsapp" },
          select: { id: true },
        });
        tplConversationId = conv?.id;
      }

      if (tplConversationId) {
        let tplBodyPreview: string | null = null;
        try {
          const tplCfg = await prisma.whatsAppTemplateConfig.findFirst({
            where: { metaTemplateName: templateName },
            select: { bodyPreview: true, category: true },
          });
          tplBodyPreview = tplCfg?.bodyPreview ?? null;
        } catch {}
        const tplContent = tplBodyPreview
          ? `📋 *${templateName}*\n\n${tplBodyPreview}`
          : `[Template: ${templateName}]`;

        const saved = await prisma.message.create({
          data: {
            conversationId: tplConversationId,
            content: tplContent,
            direction: "out",
            messageType: "template",
            senderName: "Automação",
            externalId: tplExternalId,
          },
        });

        await prisma.conversation.update({
          where: { id: tplConversationId },
          data: { lastMessageDirection: "out", hasAgentReply: true, updatedAt: new Date() },
        }).catch(() => {});

        sseBus.publish("new_message", {
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
      if (!metaWhatsApp.configured) throw new Error("send_whatsapp_media: Meta WhatsApp API não configurada");
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

      let sendResult: { messages: Array<{ id: string }> };
      let displayContent: string;

      const isLocalFile = mediaUrl.startsWith("/uploads/");

      if (isLocalFile) {
        const { readFile } = await import("fs/promises");
        const { join, extname, basename } = await import("path");
        const filePath = join(process.cwd(), "public", mediaUrl);
        const buffer = await readFile(filePath);
        const ext = extname(mediaUrl).toLowerCase();
        const mimeMap: Record<string, string> = {
          ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
          ".webp": "image/webp", ".gif": "image/gif",
          ".mp4": "video/mp4", ".webm": "video/webm",
          ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
          ".pdf": "application/pdf", ".doc": "application/msword",
        };
        const mimeType = mimeMap[ext] ?? "application/octet-stream";
        const fName = filename || basename(mediaUrl);
        const metaMediaId = await metaWhatsApp.uploadMedia(buffer, mimeType, fName);
        const mType = mediaType as "image" | "audio" | "video" | "document";
        sendResult = await metaWhatsApp.sendMediaById(to, metaMediaId, mType, caption || undefined, fName, false, recipient);
        displayContent = caption || fName || `[${mediaType}]`;
      } else {
        switch (mediaType) {
          case "video":
            sendResult = await metaWhatsApp.sendVideo(to, mediaUrl, caption || undefined, recipient);
            displayContent = caption || "[Vídeo]";
            break;
          case "audio":
            sendResult = await metaWhatsApp.sendAudio(to, mediaUrl, recipient);
            displayContent = "[Áudio]";
            break;
          case "document":
            sendResult = await metaWhatsApp.sendDocument(to, mediaUrl, filename || "documento", caption || undefined, recipient);
            displayContent = caption || filename || "[Documento]";
            break;
          default:
            sendResult = await metaWhatsApp.sendImage(to, mediaUrl, caption || undefined, recipient);
            displayContent = caption || "[Imagem]";
            break;
        }
      }

      const mediaExternalId = sendResult.messages?.[0]?.id ?? null;

      if (rt.contactId) {
        const conv = await prisma.conversation.findFirst({
          where: { contactId: rt.contactId, channel: "whatsapp" },
          select: { id: true },
        });
        if (conv) {
          await prisma.message.create({
            data: {
              conversationId: conv.id,
              content: displayContent,
              direction: "out",
              messageType: mediaType,
              senderName: "Automação",
              externalId: mediaExternalId,
              mediaUrl,
            },
          });
          sseBus.publish("new_message", {
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
      if (!metaWhatsApp.configured) throw new Error("send_whatsapp_interactive: Meta WhatsApp API não configurada");
      const phoneRaw = readString(cfg, "phone")?.trim() || rt.contact?.phone || "";
      const digits = phoneRaw.replace(/\D/g, "");
      const to = digits.length >= 8 ? digits : undefined;
      const recipient = readString(cfg, "recipient")?.trim() || rt.contact?.whatsappBsuid?.trim() || undefined;
      if (!to && !recipient) throw new Error("send_whatsapp_interactive: sem destino");

      const body = readString(cfg, "body");
      if (!body) throw new Error("send_whatsapp_interactive: body obrigatório");

      const rawButtons = Array.isArray(cfg.buttons) ? cfg.buttons as { id?: string; title?: string; text?: string; gotoStepId?: string }[] : [];
      const buttons = rawButtons.slice(0, 3).map((b, i) => ({
        id: b.id || `btn_${i}`,
        title: (b.title || b.text || `Opção ${i + 1}`).slice(0, 20),
      }));
      if (buttons.length === 0) throw new Error("send_whatsapp_interactive: pelo menos 1 botão obrigatório");

      const header = readString(cfg, "header");
      const footer = readString(cfg, "footer");

      const btnLabels = buttons.map((b) => b.title).join(", ");
      const displayContent = `${body}\n[Botões: ${btnLabels}]`;

      let conversationId: string | undefined;
      if (rt.contactId) {
        const conv = await prisma.conversation.findFirst({
          where: { contactId: rt.contactId, channel: "whatsapp" },
          select: { id: true },
        });
        conversationId = conv?.id;
      }

      let externalId: string | null = null;
      try {
        const sendResult = await metaWhatsApp.sendInteractiveButtons(to, body, buttons, header, footer, recipient);
        externalId = sendResult.messages?.[0]?.id ?? null;
      } catch (sendErr) {
        const errMsg = formatMetaSendError(sendErr);
        log.error(`Envio WhatsApp interativo falhou (contato=${rt.contactId ?? "—"}): ${errMsg}`);
        if (conversationId) {
          await prisma.message
            .create({
              data: {
                conversationId,
                content: displayContent,
                direction: "out",
                messageType: "interactive",
                senderName: "Automação",
                sendStatus: "failed",
                sendError: errMsg.slice(0, 500),
              },
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
          data: {
            conversationId,
            content: displayContent,
            direction: "out",
            messageType: "interactive",
            senderName: "Automação",
            externalId,
          },
        });
        sseBus.publish("new_message", {
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
      const bodyPayload = { event: rt.event, contactId: rt.contactId ?? null, dealId: rt.dealId ?? null, data: rt.data };
      const h = new Headers({ "Content-Type": "application/json" });
      for (const [k, v] of Object.entries(headers)) { if (typeof v === "string") h.set(k, v); }
      const res = await fetch(url, {
        method, headers: h,
        body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(bodyPayload),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`webhook: HTTP ${res.status}`);
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
        contact: rt.contact ? { ...rt.contact } : {},
        // `rt.deal` já carrega `stageName`, `pipelineId` e `pipelineName`
        // em runtime (ver `resolveRuntimeContext`). As versões "por ID"
        // ficam disponíveis pra retrocompatibilidade, e os novos campos
        // "por nome" são o caminho preferido nas novas conditions.
        deal: rt.deal ? { ...rt.deal } : {},
        conversation: rt.conversation ?? null,
        data: rt.data,
        event: rt.event,
        variables: flowVars ?? {},
      };

      const conditionCfg = normalizeConditionConfig(cfg);
      for (const branch of conditionCfg.branches) {
        const allMatch = branch.rules.every((rule) => {
          const left = rule.field ? getByPath(evalRoot, rule.field) : undefined;
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
        if (!metaWhatsApp.configured) {
          throw new Error("question: Meta WhatsApp API não configurada");
        }
        const phoneRaw = rt.contact?.phone ?? "";
        const digits = phoneRaw.replace(/\D/g, "");
        const to = digits.length >= 8 ? digits : undefined;
        const recipient = rt.contact?.whatsappBsuid?.trim() || undefined;
        if (to || recipient) {
          const vars = (cfg as Record<string, unknown>)["__variables"] as Record<string, unknown> | undefined;
          const interpolated = vars ? interpolateVariables(content, vars) : content;
          const sendResult = await metaWhatsApp.sendText(to, interpolated, recipient);
          const externalId = sendResult.messages?.[0]?.id ?? null;

          const conv = await prisma.conversation.findFirst({
            where: { contactId: rt.contactId, channel: "whatsapp" },
            select: { id: true },
          });
          if (conv) {
            await prisma.message.create({
              data: { conversationId: conv.id, content: interpolated, direction: "out", messageType: "text", senderName: "Automação", externalId },
            });
            sseBus.publish("new_message", { conversationId: conv.id, contactId: rt.contactId, direction: "out", content: interpolated });
          }
        }
      }
      const automation = await prisma.automation.findUnique({
        where: { id: rt.automationId },
        include: { steps: { orderBy: { position: "asc" }, select: { id: true, type: true } } },
      });
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
      const title = readString(cfg, "title") ?? "Novo negócio";
      const rawValue = readNumber(cfg, "value");
      const stage = await prisma.stage.findUnique({
        where: { id: stageId },
        select: { name: true, pipelineId: true, pipeline: { select: { name: true } } },
      });
      if (!stage) throw new Error("create_deal: stageId inválido");
      const deal = await prisma.deal.create({
        data: {
          title,
          contactId: rt.contactId,
          stageId,
          status: "OPEN",
          ...(rawValue != null ? { value: new Prisma.Decimal(String(rawValue)) } : {}),
        },
      });
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

    default:
      throw new Error(`Tipo de passo desconhecido: ${stepType}`);
  }
}

const WA_SEND_STEP_TYPES = new Set([
  "send_whatsapp_message",
  "send_whatsapp_template",
  "send_whatsapp_media",
  "send_whatsapp_interactive",
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
  wamid: string | null
): Promise<void> {
  if (!WA_SEND_STEP_TYPES.has(stepType) || !wamid || !metaWhatsApp.configured) return;
  if (humanize.simulateTyping) {
    try {
      await metaWhatsApp.sendTypingIndicator(wamid);
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
  const contactName = contact?.name ?? "Contato";

  const contextData = typeof context.data === "object" && context.data !== null
    ? context.data as Record<string, unknown>
    : {};

  const wamid =
    (typeof contextData.waMessageId === "string" ? contextData.waMessageId : null) ||
    (context.contactId ? await getLastInboundWamid(context.contactId) : null);

  if (humanize.markAsRead && wamid && metaWhatsApp.configured) {
    try {
      await metaWhatsApp.markAsRead(wamid);
    } catch (err) {
      log.debug("Falha ao marcar mensagem como lida:", err instanceof Error ? err.message : err);
    }
  }

  await logStep({
    automationId,
    contactId: context.contactId,
    dealId: context.dealId,
    status: "STARTED",
    message: `${contactName} — ${context.event === "message_received" ? "mensagem recebida" : context.event}`,
    payload: {
      evento: context.event,
      contato: contactName,
      telefone: contact?.phone ?? undefined,
      ...(contextData.content ? { mensagem: String(contextData.content).slice(0, 200) } : {}),
      ...(contextData.channel ? { canal: contextData.channel } : {}),
    },
  });

  const rt = await resolveRuntimeContext(automationId, payload);
  if (!rt) {
    await logStep({ automationId, contactId: context.contactId, dealId: context.dealId, status: "FAILED", message: `Contato ou negócio não encontrado` });
    return;
  }

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

    await humanizeBeforeStep(step.type, humanize, wamid);

    let result: StepResult;
    try {
      result = await executeStep(step.type, enrichedConfig, rt);
      if (result.setVariable) {
        flowVariables = { ...flowVariables, [result.setVariable.name]: result.setVariable.value };
        rt.data = { ...rt.data, ...flowVariables };
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
      ? `Finalizada com erros (${automation.steps.length} passos)`
      : `Finalizada com sucesso (${automation.steps.length} passos)`,
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
  }
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

  const rt: RuntimeContext = {
    automationId,
    contactId,
    dealId: deal?.id,
    event: "continue",
    data: variables,
    contact,
    deal,
    conversation,
  };

  const contactName = contact.name ?? "Contato";

  const wamid = await getLastInboundWamid(contactId);

  if (humanize.markAsRead && wamid && metaWhatsApp.configured) {
    try {
      await metaWhatsApp.markAsRead(wamid);
    } catch (err) {
      log.debug("Falha ao marcar mensagem como lida (continuação):", err instanceof Error ? err.message : err);
    }
  }

  await logStep({
    automationId,
    contactId,
    dealId: deal?.id,
    status: "STARTED",
    message: `${contactName} — continuando fluxo`,
  });

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

    await humanizeBeforeStep(step.type, humanize, wamid);

    let result: StepResult;
    try {
      result = await executeStep(step.type, stepConfig, rt);
      if (result.setVariable) {
        flowVariables = { ...flowVariables, [result.setVariable.name]: result.setVariable.value };
        rt.data = { ...rt.data, ...flowVariables };
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
    message: `Finalizada com sucesso`,
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
}
