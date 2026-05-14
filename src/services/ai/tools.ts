/**
 * Tools disponíveis para agentes de IA.
 *
 * Cada tool é exposta como um objeto do Vercel AI SDK (via helper
 * `tool({...})`). O runner monta o `ToolSet` que vai pro LLM chamando
 * `buildToolSet(ctx, enabledIds)` — com isso apenas as tools que o
 * admin marcou em `AIAgentConfig.enabledTools` ficam disponíveis pra
 * aquele agente específico.
 *
 * Reaproveitamos os services existentes (deals, activities, tags...)
 * em vez de duplicar lógica. Os erros são capturados e devolvidos
 * como `{ ok: false, error }` pra que o LLM possa raciocinar sobre
 * falhas em vez de derrubar a run inteira.
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { metaClientFromConfig } from "@/lib/meta-whatsapp/client";
import { enrichTemplateComponentsForFlowSend } from "@/lib/meta-whatsapp/enrich-template-flow";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { getOrgIdOrNull } from "@/lib/request-context";
import { sseBus } from "@/lib/sse-bus";
import { createActivity } from "@/services/activities";
import { createDeal, createDealEvent, updateDeal } from "@/services/deals";
import { addTagToContact } from "@/services/tags";
import type { ActivityType, Prisma } from "@prisma/client";

export type RunContext = {
  /// User.id do agente AI (para logar autoria em atividades, deals etc).
  agentUserId: string;
  /// ID do agente (AIAgentConfig.id) — opcional, para auditoria.
  agentId?: string;
  /// Conversa em curso (se aplicável). Quase todas as tools precisam dela
  /// pra enviar mensagens ou abrir ticket.
  conversationId?: string | null;
  /// Contato em curso.
  contactId?: string | null;
  /// Deal em curso (se houver um aberto para este contato).
  dealId?: string | null;
};

function ok<T>(data: T) {
  return { ok: true as const, ...data } as { ok: true } & T;
}
function fail(error: string) {
  return { ok: false as const, error };
}

// ── create_deal ────────────────────────────────────────────────

function createDealTool(ctx: RunContext) {
  return tool({
    description:
      "Cria um novo deal (oportunidade) no primeiro estágio do pipeline padrão, associado ao contato atual. Use quando qualificar um lead novo e quiser registrar a oportunidade.",
    inputSchema: z.object({
      title: z.string().min(3).describe("Título curto do deal, ex: 'Curso de inglês — João Silva'."),
      value: z
        .number()
        .optional()
        .describe("Valor estimado em BRL. Omita se ainda não souber."),
      notes: z
        .string()
        .optional()
        .describe("Observação opcional a ser registrada como primeira atividade do deal."),
    }),
    execute: async ({ title, value, notes }) => {
      try {
        if (!ctx.contactId) return fail("Sem contato associado para criar deal.");
        const defaultPipeline = await prisma.pipeline.findFirst({
          where: { isDefault: true },
          include: { stages: { orderBy: { position: "asc" }, take: 1 } },
        });
        const stage = defaultPipeline?.stages[0];
        if (!stage) return fail("Pipeline padrão sem estágios configurados.");
        const deal = await createDeal({
          title,
          value,
          contactId: ctx.contactId,
          stageId: stage.id,
          ownerId: ctx.agentUserId,
        });
        if (notes?.trim()) {
          await createActivity({
            type: "NOTE",
            title: "Nota do agente IA",
            description: notes.trim(),
            completed: true,
            dealId: deal.id,
            contactId: ctx.contactId,
            userId: ctx.agentUserId,
          }).catch(() => null);
        }
        createDealEvent(deal.id, ctx.agentUserId, "AI_AGENT_ACTION", {
          action: "created_deal",
          agentId: ctx.agentId ?? null,
          title: deal.title,
          value: value ?? null,
        }).catch(() => {});
        return ok({ dealId: deal.id, title: deal.title });
      } catch (err) {
        return fail(err instanceof Error ? err.message : "Falha ao criar deal.");
      }
    },
  });
}

// ── move_stage ─────────────────────────────────────────────────

function moveStageTool(ctx: RunContext) {
  return tool({
    description:
      "Move o deal atual para outro estágio do funil (identificado por nome do estágio). Use quando o lead avançar na jornada (ex: de 'Qualificação' para 'Proposta').",
    inputSchema: z.object({
      stageName: z
        .string()
        .describe("Nome do estágio de destino (match case-insensitive, ex: 'Proposta')."),
      reason: z
        .string()
        .optional()
        .describe("Motivo do movimento; vira nota anexada ao deal."),
    }),
    execute: async ({ stageName, reason }) => {
      try {
        if (!ctx.dealId) return fail("Sem deal ativo para mover.");
        const deal = await prisma.deal.findUnique({
          where: { id: ctx.dealId },
          select: { id: true, stageId: true, stage: { select: { pipelineId: true } } },
        });
        if (!deal) return fail("Deal não encontrado.");
        const target = await prisma.stage.findFirst({
          where: {
            pipelineId: deal.stage.pipelineId,
            name: { equals: stageName, mode: "insensitive" },
          },
          select: { id: true, name: true },
        });
        if (!target)
          return fail(`Estágio "${stageName}" não existe no pipeline deste deal.`);
        await updateDeal(deal.id, { stageId: target.id });
        createDealEvent(deal.id, ctx.agentUserId, "AI_AGENT_ACTION", {
          action: "moved_stage",
          agentId: ctx.agentId ?? null,
          stageId: target.id,
          stageName: target.name,
          reason: reason?.trim() ?? null,
        }).catch(() => {});
        if (reason?.trim() && ctx.contactId) {
          await createActivity({
            type: "NOTE",
            title: `Movido para ${target.name}`,
            description: reason.trim(),
            completed: true,
            dealId: deal.id,
            contactId: ctx.contactId,
            userId: ctx.agentUserId,
          }).catch(() => null);
        }
        return ok({ stageId: target.id, stageName: target.name });
      } catch (err) {
        return fail(err instanceof Error ? err.message : "Falha ao mover deal.");
      }
    },
  });
}

// ── add_tag ────────────────────────────────────────────────────

function addTagTool(ctx: RunContext) {
  return tool({
    description:
      "Adiciona uma tag ao contato atual. Se a tag não existir, ela é criada. Útil para segmentar leads por interesse, origem ou qualificação.",
    inputSchema: z.object({
      tagName: z.string().min(1).describe("Nome da tag, ex: 'Interessado em premium'."),
    }),
    execute: async ({ tagName }) => {
      try {
        if (!ctx.contactId) return fail("Sem contato para marcar.");
        const name = tagName.trim();
        if (!name) return fail("Nome de tag vazio.");
        let tag = await prisma.tag.findFirst({
          where: { name: { equals: name, mode: "insensitive" } },
          select: { id: true, name: true },
        });
        if (!tag) {
          tag = await prisma.tag.create({
            data: withOrgFromCtx({ name, color: "#64748b" }),
            select: { id: true, name: true },
          });
        }
        const already = await prisma.tagOnContact.findFirst({
          where: { contactId: ctx.contactId, tagId: tag.id },
          select: { contactId: true },
        });
        if (!already) {
          await addTagToContact(ctx.contactId, tag.id);
        }
        if (ctx.dealId && !already) {
          createDealEvent(ctx.dealId, ctx.agentUserId, "AI_AGENT_ACTION", {
            action: "added_tag",
            agentId: ctx.agentId ?? null,
            tagName: tag.name,
          }).catch(() => {});
        }
        return ok({ tagId: tag.id, tagName: tag.name, alreadyHad: !!already });
      } catch (err) {
        return fail(err instanceof Error ? err.message : "Falha ao marcar tag.");
      }
    },
  });
}

// ── create_activity ────────────────────────────────────────────

const ACTIVITY_TYPES = ["CALL", "EMAIL", "MEETING", "TASK", "NOTE", "WHATSAPP", "OTHER"] as const;

function createActivityTool(ctx: RunContext) {
  return tool({
    description:
      "Registra uma atividade ou follow-up vinculado ao contato/deal atual. Útil para 'ligar amanhã 15h' ou deixar uma nota pro time comercial.",
    inputSchema: z.object({
      type: z.enum(ACTIVITY_TYPES).describe("Tipo (CALL, TASK, NOTE, MEETING...)"),
      title: z.string().min(3),
      description: z.string().optional(),
      scheduledAt: z
        .string()
        .optional()
        .describe("ISO 8601 — ex: '2026-05-01T15:00:00-03:00'. Omita para nota sem data."),
    }),
    execute: async ({ type, title, description, scheduledAt }) => {
      try {
        const activity = await createActivity({
          type: type as ActivityType,
          title,
          description,
          scheduledAt: scheduledAt ?? undefined,
          completed: type === "NOTE",
          contactId: ctx.contactId ?? undefined,
          dealId: ctx.dealId ?? undefined,
          userId: ctx.agentUserId,
        });
        return ok({ activityId: activity.id });
      } catch (err) {
        return fail(err instanceof Error ? err.message : "Falha ao criar atividade.");
      }
    },
  });
}

// ── send_whatsapp_template ─────────────────────────────────────

function sendWhatsappTemplateTool(ctx: RunContext) {
  return tool({
    description:
      "Envia um template aprovado pela Meta para o contato atual via WhatsApp. Use para reengajar após janela de 24h ou enviar propostas padronizadas. O template deve existir em /templates.",
    inputSchema: z.object({
      templateName: z.string().describe("Nome exato do template aprovado."),
      languageCode: z.string().default("pt_BR").optional(),
      bodyVariables: z
        .array(z.string())
        .optional()
        .describe("Variáveis de {{1}}, {{2}}... do template, em ordem."),
    }),
    execute: async ({ templateName, languageCode, bodyVariables }) => {
      try {
        if (!ctx.contactId) return fail("Sem contato.");
        // Multi-tenancy: resolve o cliente Meta a partir do canal da
        // conversa atual em vez do singleton global. Sem isso, o LLM da
        // org B chamaria sendTemplate pelo numero da Eduit (env vars).
        if (!ctx.conversationId) return fail("Sem conversa ativa.");
        const conv = await prisma.conversation.findUnique({
          where: { id: ctx.conversationId },
          select: {
            organizationId: true,
            channelRef: { select: { config: true } },
          },
        });
        if (!conv) return fail("Conversa não encontrada.");
        const channelConfig = conv.channelRef?.config as
          | Record<string, unknown>
          | null
          | undefined;
        const metaClient = metaClientFromConfig(channelConfig);
        if (!metaClient.configured) return fail("Canal Meta não configurado.");
        const contact = await prisma.contact.findUnique({
          where: { id: ctx.contactId },
          select: { phone: true },
        });
        if (!contact?.phone) return fail("Contato sem telefone.");
        const lc = languageCode ?? "pt_BR";
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
        const baseComponents =
          Array.isArray(bodyVariables) && bodyVariables.length > 0
            ? [
                {
                  type: "body",
                  parameters: bodyVariables.map((text) => ({
                    type: "text" as const,
                    text,
                  })),
                },
              ]
            : undefined;
        const enrichSend = await enrichTemplateComponentsForFlowSend(metaClient, {
          templateName,
          languageCode: lc,
          components: baseComponents,
          templateGraphId,
        });
        const res = await metaClient.sendTemplate(
          contact.phone,
          templateName,
          lc,
          enrichSend.components,
        );
        const externalId = res?.messages?.[0]?.id ?? null;
        const saved = await prisma.message.create({
          data: withOrgFromCtx({
            conversationId: ctx.conversationId,
            content: `[Template: ${templateName}]`,
            direction: "out",
            messageType: "template",
            senderName: "Agente IA",
            externalId,
            aiAgentUserId: ctx.agentUserId,
            ...(typeof enrichSend.flowToken === "string" && enrichSend.flowToken.trim()
              ? { flowToken: enrichSend.flowToken.trim() }
              : {}),
          }),
        });
        await prisma.conversation
          .update({
            where: { id: ctx.conversationId },
            data: {
              lastMessageDirection: "out",
              hasAgentReply: true,
              updatedAt: new Date(),
            },
          })
          .catch(() => null);
        sseBus.publish("new_message", {
          organizationId: conv.organizationId,
          conversationId: ctx.conversationId,
          contactId: ctx.contactId,
          direction: "out",
          content: saved.content,
          timestamp: saved.createdAt,
        });
        return ok({ externalId, templateName });
      } catch (err) {
        return fail(err instanceof Error ? err.message : "Falha ao enviar template.");
      }
    },
  });
}

// ── search_products ────────────────────────────────────────────

/**
 * Tool de consulta ao catálogo de produtos/serviços.
 *
 * É a fonte de verdade pro agente responder preço, descrição, SKU,
 * tipo. O system prompt injeta uma política de apresentação (campo
 * `productPolicy` do AIAgentConfig) que orienta COMO o LLM deve
 * expor os dados devolvidos aqui.
 *
 * Busca é TOLERANTE A ACENTOS (normalização NFD) e MULTI-PALAVRA —
 * porque `contains` do Postgres é case-insensitive mas NÃO
 * accent-insensitive, e o LLM frequentemente manda variações
 * ("administracao", "curso de administração", etc.). Nós trazemos
 * os candidatos ativos e filtramos em memória, rankeando por quão
 * bem o termo bate no nome. Custom fields (modalidade, duração,
 * etc.) também entram no haystack pra cobrir perguntas por
 * atributo (ex.: "curso EAD", "4 anos").
 *
 * Sempre devolvemos preço como número + string formatada em BRL —
 * o LLM tende a errar menos usando a versão já formatada.
 */

/** Normaliza string pra busca: lowercase + remove acentos. */
function normalizeForSearch(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function searchProductsTool(ctx: RunContext) {
  return tool({
    description:
      "Busca produtos, serviços ou cursos no catálogo interno por nome, SKU, descrição ou atributos. Use SEMPRE antes de responder sobre preço, modalidade, duração, características ou disponibilidade — nunca invente esses dados. Busca tolera acentos e múltiplas palavras. Retorna até 5 itens com preço formatado em BRL e campos personalizados (modalidade, carga horária, etc.).",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe(
          "Termo de busca livre. Ex.: 'Administração', 'curso EAD', 'ABC-001', 'direito presencial'. A busca tolera acentos e procura em nome, SKU, descrição e campos personalizados.",
        ),
      type: z
        .enum(["PRODUCT", "SERVICE"])
        .optional()
        .describe(
          "Filtro opcional pelo tipo. Use 'PRODUCT' para produtos/cursos ou 'SERVICE' para serviços. Omita para buscar em todos.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Máximo de itens a retornar (1-20, padrão 5)."),
    }),
    execute: async ({ query, type, limit }) => {
      try {
        const term = query.trim();
        if (!term) return fail("Busca vazia.");
        const take = Math.min(Math.max(limit ?? 5, 1), 20);

        const where: Prisma.ProductWhereInput = { isActive: true };
        if (type) where.type = type;

        // Traz todos os candidatos ativos (limitado pra não estourar
        // memória em catálogos gigantes). Em catálogos >500 itens
        // vale migrar pra índice pg_trgm + unaccent no Postgres.
        const candidates = await prisma.product.findMany({
          where,
          take: 500,
          orderBy: [{ name: "asc" }],
          include: {
            customValues: {
              include: {
                customField: {
                  select: { id: true, name: true, label: true, type: true },
                },
              },
            },
          },
        });

        const termN = normalizeForSearch(term);
        const words = termN.split(/\s+/).filter((w) => w.length >= 2);

        type WithScore = { product: (typeof candidates)[number]; score: number };
        const scored: WithScore[] = [];

        for (const p of candidates) {
          const nameN = normalizeForSearch(p.name);
          const skuN = normalizeForSearch(p.sku);
          const descN = normalizeForSearch(p.description);
          const cfN = p.customValues
            .map((v) => normalizeForSearch(v.value))
            .join(" ");
          const haystack = `${nameN} ${skuN} ${descN} ${cfN}`;

          // Match principal: termo inteiro aparece em nome/sku (ranking alto)
          // Fallback: TODAS as palavras (>=2 chars) aparecem em qualquer campo
          let score = 0;
          if (termN && nameN.includes(termN)) score = 100;
          else if (termN && skuN.includes(termN)) score = 80;
          else if (
            words.length > 0 &&
            words.every((w) => haystack.includes(w))
          ) {
            // score cresce conforme as palavras baterem no nome especificamente
            score =
              30 +
              words.filter((w) => nameN.includes(w)).length * 10;
          }

          if (score > 0) scored.push({ product: p, score });
        }

        scored.sort((a, b) => b.score - a.score);
        const matched = scored.slice(0, take).map((s) => s.product);

        if (matched.length === 0) {
          return ok({
            query: term,
            total: 0,
            products: [],
            hint:
              "Nenhum produto ativo encontrado para este termo. Não invente dados — diga que vai confirmar com o time e ofereça handoff humano.",
          });
        }

        const fmtBRL = new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        });

        const serialized = matched.map((p) => {
          const priceNum = Number(p.price);
          return {
            id: p.id,
            name: p.name,
            sku: p.sku,
            type: p.type,
            unit: p.unit,
            price: priceNum,
            priceFormatted: fmtBRL.format(priceNum),
            description: p.description ?? null,
            customFields: p.customValues
              .filter((v) => v.value && v.value.trim())
              .map((v) => ({
                name: v.customField.name,
                label: v.customField.label,
                value: v.value,
              })),
          };
        });

        return ok({
          query: term,
          total: serialized.length,
          products: serialized,
        });
      } catch (err) {
        return fail(
          err instanceof Error ? err.message : "Falha ao buscar produtos.",
        );
      }
    },
  });
}

// ── transfer_to_human ──────────────────────────────────────────

function transferToHumanTool(ctx: RunContext) {
  return tool({
    description:
      "Transfere a conversa atual para um atendente humano. Use sempre que o assunto sair do seu escopo, quando o cliente pedir explicitamente, ou quando detectar insatisfação/risco. Após chamar, NÃO envie mais mensagens — pare de responder.",
    inputSchema: z.object({
      reason: z
        .string()
        .describe(
          "Motivo curto do handoff, para o atendente ler (ex: 'Cliente pediu falar com humano sobre reembolso').",
        ),
    }),
    execute: async ({ reason }) => {
      try {
        if (!ctx.conversationId) return fail("Sem conversa ativa.");
        await prisma.conversation.update({
          where: { id: ctx.conversationId },
          data: {
            assignedToId: null,
            updatedAt: new Date(),
          },
        });
        if (ctx.contactId) {
          await createActivity({
            type: "NOTE",
            title: "Transferência IA → humano",
            description: reason,
            completed: true,
            contactId: ctx.contactId,
            dealId: ctx.dealId ?? undefined,
            userId: ctx.agentUserId,
          }).catch(() => null);
        }
        sseBus.publish("conversation_unassigned", {
          organizationId: getOrgIdOrNull(),
          conversationId: ctx.conversationId,
          contactId: ctx.contactId,
          reason,
        });
        if (ctx.dealId) {
          createDealEvent(ctx.dealId, ctx.agentUserId, "AI_AGENT_ACTION", {
            action: "transferred_to_human",
            agentId: ctx.agentId ?? null,
            reason,
          }).catch(() => {});
        }
        return ok({ transferred: true });
      } catch (err) {
        return fail(err instanceof Error ? err.message : "Falha ao transferir.");
      }
    },
  });
}

// ── ToolSet builder ────────────────────────────────────────────

// Usamos `any` pro Tool porque cada tool tem um inputSchema e output
// diferentes; o ToolSet do AI SDK aceita tools heterogêneas, mas
// TypeScript não consegue inferir isso automaticamente sem este cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = ReturnType<typeof tool<any, any>>;

const FACTORY_MAP: Record<string, (ctx: RunContext) => AnyTool> = {
  create_deal: createDealTool,
  move_stage: moveStageTool,
  add_tag: addTagTool,
  create_activity: createActivityTool,
  search_products: searchProductsTool,
  send_whatsapp_template: sendWhatsappTemplateTool,
  transfer_to_human: transferToHumanTool,
};

export function buildToolSet(ctx: RunContext, enabledIds: string[]): ToolSet {
  const set: Record<string, AnyTool> = {};
  for (const id of enabledIds) {
    const factory = FACTORY_MAP[id];
    if (factory) set[id] = factory(ctx);
  }
  return set as ToolSet;
}

export const AVAILABLE_TOOL_IDS = Object.keys(FACTORY_MAP);
