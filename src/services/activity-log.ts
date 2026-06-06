/**
 * Activity Log central (Kommo-grade) — log de atividade unificado.
 *
 * Substitui gradualmente `createDealEvent()`: este helper aceita
 * qualquer tipo de entidade-sujeito (DEAL, CONTACT, CONVERSATION, ...)
 * e resolve a atribuicao rica de ator a partir do `RequestContext`
 * (tipo + label + sublabel + ref).
 *
 * Caracteristicas:
 *   - Fire-and-forget: nunca derruba a request principal. Erros sao
 *     logados em console.warn e suprimidos.
 *   - Org-scoped: usa `withOrgFromCtx`, herdando a org da extension.
 *   - Idempotente em relacao ao ator: se nao houver `actor` no contexto,
 *     deriva um default sensato (HUMAN se houver `userId` real, SYSTEM
 *     caso contrario).
 *   - Sem dependencia circular: `services/deals.ts` pode importar e
 *     `createDealEvent` vira um wrapper fino sobre este.
 */

import type { ActorType, EventEntityType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import {
  getActorContext,
  getRequestContext,
  type ContextActor,
} from "@/lib/request-context";

export type LogEventInput = {
  /// Tipo do evento (SCREAMING_SNAKE_CASE). Ex.: STAGE_CHANGED,
  /// MESSAGE_SENT, CONTACT_CREATED, OWNER_CHANGED, FIELD_CHANGED,
  /// TAG_ADDED, AUTOMATION_EXECUTED, AI_AGENT_HANDOFF.
  type: string;

  // ── Sujeito ────────────────────────────────────────────────────
  entityType: EventEntityType;
  entityId: string;
  /// Snapshot textual do sujeito (titulo do lead, "Lead #<number>",
  /// nome do contato, codigo da conversa). Recomendado para nao
  /// precisar de join na hora de renderizar o feed.
  entityLabel?: string | null;

  // Escopo secundario para filtros rapidos. Preencha o que fizer
  // sentido — ex.: mensagem nova num deal aberto do contato passa
  // os 3 (dealId, contactId, conversationId).
  dealId?: string | null;
  contactId?: string | null;
  conversationId?: string | null;

  // ── Conteudo ───────────────────────────────────────────────────
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  meta?: Record<string, unknown>;

  // ── Override de ator (raro) ────────────────────────────────────
  /// Quando o caller sabe melhor que o contexto quem fez a acao
  /// (ex.: worker de automation que recebe o actor por payload),
  /// pode forcar aqui em vez de mexer no RequestContext.
  actor?: ContextActor;
};

/// Default seguro: se o contexto nao trouxer ator, infere a partir do
/// userId. Mantem a auditoria minimamente util mesmo em call-sites
/// que ainda nao foram migrados pra popular `actor`.
function resolveActor(input: LogEventInput): {
  actorType: ActorType;
  actorUserId: string | null;
  actorLabel: string | null;
  actorSublabel: string | null;
  actorRef: string | null;
} {
  const override = input.actor;
  const ctx = getRequestContext();
  const ctxActor = override ?? getActorContext();

  // userId real = nao e placeholder de webhook/system/cron
  const rawUserId = ctx?.userId;
  const isSyntheticUserId =
    !rawUserId ||
    rawUserId === "system" ||
    rawUserId === "webhook" ||
    rawUserId === "cron";
  const userIdForFk = isSyntheticUserId ? null : rawUserId ?? null;

  if (ctxActor) {
    return {
      actorType: ctxActor.type as ActorType,
      actorUserId: userIdForFk,
      actorLabel: ctxActor.label ?? null,
      actorSublabel: ctxActor.sublabel ?? null,
      actorRef: ctxActor.ref ?? null,
    };
  }

  if (userIdForFk) {
    return {
      actorType: "HUMAN" as ActorType,
      actorUserId: userIdForFk,
      actorLabel: null,
      actorSublabel: null,
      actorRef: null,
    };
  }

  return {
    actorType: "SYSTEM" as ActorType,
    actorUserId: null,
    actorLabel: "Sistema",
    actorSublabel: null,
    actorRef: null,
  };
}

/// Helper principal. Fire-and-forget (retorna Promise mas catch interno
/// evita propagar falhas para o caller). Use `await` se quiser garantir
/// ordem com outras escritas — em geral, deixe sem await.
export async function logEvent(input: LogEventInput): Promise<void> {
  try {
    const actor = resolveActor(input);
    const metaJson = (input.meta ?? {}) as Prisma.InputJsonValue;

    await prisma.activityEvent.create({
      data: withOrgFromCtx({
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId,
        entityLabel: input.entityLabel ?? null,
        dealId: input.dealId ?? null,
        contactId: input.contactId ?? null,
        conversationId: input.conversationId ?? null,
        actorType: actor.actorType,
        actorUserId: actor.actorUserId,
        actorLabel: actor.actorLabel,
        actorSublabel: actor.actorSublabel,
        actorRef: actor.actorRef,
        field: input.field ?? null,
        oldValue: input.oldValue ?? null,
        newValue: input.newValue ?? null,
        meta: metaJson,
      }),
    });
  } catch (err) {
    // ATENCAO: logEvent jamais deve derrubar a request principal.
    // Falhas de FK / org context ausente / DB indisponivel sao
    // logadas mas suprimidas.
    console.warn("[activity-log] logEvent failed:", {
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/// Atalho usado pelo backfill / wrapper de `createDealEvent`. Recebe
/// o objeto serializado direto e nao deriva ator do contexto.
export async function logEventRaw(
  data: Prisma.ActivityEventUncheckedCreateInput,
): Promise<void> {
  try {
    await prisma.activityEvent.create({ data });
  } catch (err) {
    console.warn("[activity-log] logEventRaw failed:", {
      type: data.type,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
