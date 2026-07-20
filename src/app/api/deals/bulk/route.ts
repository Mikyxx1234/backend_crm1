import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";
import { LEADS_BULK_JOB_NAMES, enqueueLeadsBulk } from "@/lib/queue";
import { fireTrigger, notifyDealStageChanged } from "@/services/automation-triggers";
import {
  assertLostReasonAllowed,
  assignDealOwner,
  createDealEvent,
  markDealLost,
  markDealWon,
} from "@/services/deals";

const VALID_ACTIONS = ["move_stage", "change_owner", "mark_won", "mark_lost", "delete"] as const;
type BulkAction = (typeof VALID_ACTIONS)[number];

/**
 * Threshold acima do qual `move_stage` automaticamente roda async via worker.
 * Abaixo do threshold (e sem `async: true` explícito no body), mantém o
 * comportamento síncrono histórico para não quebrar UIs existentes que
 * esperam `{ affected: number }` na resposta.
 */
const ASYNC_AUTO_THRESHOLD = 50;

/**
 * Bug 23/mai/26: usavamos `auth()` direto. As chamadas a `createDealEvent`
 * dentro do for loop (no path sync de move_stage / mark_won / mark_lost)
 * invocam `withOrgFromCtx({...})` SINCRONICAMENTE no payload de
 * prisma.dealEvent.create — que avalia ANTES da Prisma extension rodar
 * (e portanto antes do fallback de cookie popular ctx). Resultado: o
 * `withOrgFromCtx` jogava sync, escapava do `.catch(() => {})` registrado
 * pelo caller (Promise nem chegava a ser criada) e batia no try/catch
 * global → 500 "Erro na ação em massa." mesmo com bulk action válida.
 *
 * Migrado para `withOrgContext`, que popula o ALS via `runWithContext`
 * (storage.run, não enterWith). Isso garante que `getRequestContext()`
 * retorne ctx populado em TODO o escopo do handler — incluindo nas
 * chamadas síncronas internas de `withOrgFromCtx`. Mesmo padrão usado em
 * `/api/deals/[id]/products/route.ts` (corrigido em abr/26 pelo mesmo
 * sintoma).
 */
export async function POST(request: Request) {
  return withOrgContext(async (session) => {
    try {
      const userLike = session.user;

      const body = (await request.json()) as Record<string, unknown>;
      const dealIds = Array.isArray(body.dealIds) ? (body.dealIds as string[]).filter((id) => typeof id === "string") : [];
      const action = body.action as BulkAction;

      if (dealIds.length === 0) return NextResponse.json({ message: "Nenhum deal selecionado." }, { status: 400 });
      if (!VALID_ACTIONS.includes(action)) return NextResponse.json({ message: "Ação inválida." }, { status: 400 });
      const actionPermission: Record<BulkAction, string> = {
        move_stage: "deal:change_stage",
        change_owner: "deal:transfer_owner",
        mark_won: "deal:set_won",
        mark_lost: "deal:set_lost",
        delete: "deal:delete",
      };
      const denied = await requirePermissionForUser(userLike, actionPermission[action]);
      if (denied) return denied;

      const uid = userLike.id;
      let affected = 0;

      if (action === "move_stage") {
        const stageId = typeof body.stageId === "string" ? body.stageId : "";
        if (!stageId) return NextResponse.json({ message: "stageId é obrigatório." }, { status: 400 });
        // Motivo da perda — usado quando o destino é o estágio Perdido.
        const moveLostReason =
          typeof body.lostReason === "string" ? body.lostReason.trim() || null : null;

        // Valida o motivo livre contra a setting "Permitir outro" — antes
        // de criar BulkOperation ou de iniciar o for loop síncrono.
        if (moveLostReason) {
          try {
            await assertLostReasonAllowed(moveLostReason);
          } catch (err) {
            if (err instanceof Error && err.message === "INVALID_LOST_REASON") {
              return NextResponse.json(
                {
                  message:
                    "Motivo da perda inválido. Selecione um dos motivos cadastrados em Configurações → Motivos de perda.",
                },
                { status: 400 },
              );
            }
            throw err;
          }
        }

        const stage = await prisma.stage.findUnique({
          where: { id: stageId },
          select: {
            id: true,
            name: true,
            pipelineId: true,
            pipeline: { select: { id: true, name: true } },
          },
        });
        if (!stage) return NextResponse.json({ message: "Etapa não encontrada." }, { status: 404 });

        // Modo async opt-in: explicito (body.async=true) ou implícito por
        // tamanho (> ASYNC_AUTO_THRESHOLD). Cria BulkOperation, enfileira
        // job e devolve 202 com operationId. Frontend pollar via GET
        // /api/bulk-operations/[id]. Preserva o comportamento síncrono
        // existente para chamadas menores (compat com UI atual).
        const wantAsync =
          body.async === true || dealIds.length > ASYNC_AUTO_THRESHOLD;

        if (wantAsync) {
          if (!userLike.organizationId) {
            return NextResponse.json(
              { message: "Operação requer contexto de organização." },
              { status: 403 },
            );
          }
          const operation = await prisma.bulkOperation.create({
            data: {
              type: "DEAL_BULK_MOVE_STAGE",
              status: "PENDING",
              total: dealIds.length,
              payload: { dealIds, targetStageId: stageId, lostReason: moveLostReason },
              createdById: uid,
            },
            select: { id: true },
          });
          const job = await enqueueLeadsBulk(LEADS_BULK_JOB_NAMES.bulkMoveStage, {
            operationId: operation.id,
            organizationId: userLike.organizationId,
            initiatedByUserId: uid,
            dealIds,
            targetStageId: stageId,
            lostReason: moveLostReason,
          });
          if (!job) {
            await prisma.bulkOperation.update({
              where: { id: operation.id },
              data: {
                status: "FAILED",
                finishedAt: new Date(),
                errors: [
                  {
                    itemId: "__operation__",
                    message: "Fila de jobs indisponível (Redis offline)",
                    attempt: 0,
                    at: new Date().toISOString(),
                  },
                ],
              },
            });
            return NextResponse.json(
              {
                message: "Fila de jobs indisponível.",
                operationId: operation.id,
              },
              { status: 503 },
            );
          }
          return NextResponse.json(
            {
              message: "Operação enfileirada.",
              operationId: operation.id,
              total: dealIds.length,
              action,
            },
            { status: 202 },
          );
        }

        const targetFlags = await prisma.stage.findUnique({
          where: { id: stageId },
          select: { isWon: true, isLost: true },
        });

        const deals = await prisma.deal.findMany({
          where: { id: { in: dealIds } },
          select: {
            id: true,
            stageId: true,
            status: true,
            stage: {
              select: {
                name: true,
                pipelineId: true,
                pipeline: { select: { id: true, name: true } },
              },
            },
          },
        });

        for (const deal of deals) {
          if (deal.stageId !== stageId) {
            const pipelineChanged =
              deal.stage.pipelineId !== stage.pipelineId;
            // Estágios terminais (Ganho/Perdido) sincronizam Deal.status
            // — mesma regra do moveDeal single.
            const statusPatch = targetFlags?.isWon
              ? deal.status === "WON"
                ? {}
                : { status: "WON" as const, closedAt: new Date(), lostReason: null }
              : targetFlags?.isLost
                ? deal.status === "LOST"
                  ? {}
                  : { status: "LOST" as const, closedAt: new Date(), lostReason: moveLostReason }
                : deal.status === "OPEN"
                  ? {}
                  : { status: "OPEN" as const, closedAt: null, lostReason: null };

            await prisma.deal.update({ where: { id: deal.id }, data: { stageId, ...statusPatch } });
            createDealEvent(deal.id, uid, "STAGE_CHANGED", {
              from: {
                id: deal.stageId,
                name: deal.stage.name,
                pipelineId: deal.stage.pipelineId,
                pipelineName: deal.stage.pipeline?.name ?? null,
              },
              to: {
                id: stage.id,
                name: stage.name,
                pipelineId: stage.pipelineId,
                pipelineName: stage.pipeline?.name ?? null,
              },
              ...(pipelineChanged ? { pipelineChanged: true } : {}),
            }).catch(() => {});
            fireTrigger("stage_changed", {
              dealId: deal.id,
              data: {
                fromStageId: deal.stageId,
                toStageId: stageId,
                fromPipelineId: deal.stage.pipelineId,
                toPipelineId: stage.pipelineId,
              },
            }).catch(() => {});
            if ("status" in statusPatch && statusPatch.status && statusPatch.status !== deal.status) {
              createDealEvent(deal.id, uid, "STATUS_CHANGED", { from: deal.status, to: statusPatch.status }).catch(() => {});
              if (statusPatch.status === "WON") {
                fireTrigger("deal_won", { dealId: deal.id, data: { fromStatus: deal.status } }).catch(() => {});
              } else if (statusPatch.status === "LOST") {
                fireTrigger("deal_lost", { dealId: deal.id, data: { fromStatus: deal.status } }).catch(() => {});
              }
            }
            affected++;
          }
        }
      }

      if (action === "change_owner") {
        const ownerId = body.ownerId === null ? null : typeof body.ownerId === "string" ? body.ownerId : undefined;
        if (ownerId === undefined) return NextResponse.json({ message: "ownerId é obrigatório." }, { status: 400 });

        const ownerName = ownerId
          ? (await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } }))?.name ?? ownerId
          : null;

        const deals = await prisma.deal.findMany({
          where: { id: { in: dealIds } },
          select: { id: true, ownerId: true, owner: { select: { name: true } } },
        });

        for (const deal of deals) {
          if (deal.ownerId !== ownerId) {
            // Usa helper centralizado — propaga assignee para o
            // contato e conversas (regra de responsável único).
            await assignDealOwner(deal.id, ownerId);
            createDealEvent(deal.id, uid, "OWNER_CHANGED", {
              from: deal.ownerId ? { id: deal.ownerId, name: deal.owner?.name ?? "" } : null,
              to: ownerId ? { id: ownerId, name: ownerName } : null,
            }).catch(() => {});
            affected++;
          }
        }
      }

      if (action === "mark_won") {
        // markDealWon move o deal pro estágio terminal Ganho do pipeline
        // e sincroniza status/closedAt — mesma semântica do single.
        const deals = await prisma.deal.findMany({
          where: { id: { in: dealIds }, status: { not: "WON" } },
          select: { id: true, status: true, stageId: true },
        });
        for (const deal of deals) {
          const updated = await markDealWon(deal.id);
          createDealEvent(deal.id, uid, "STATUS_CHANGED", { from: deal.status, to: "WON" }).catch(() => {});
          fireTrigger("deal_won", { dealId: deal.id, data: { fromStatus: deal.status } }).catch(() => {});
          // markDealWon move pro estágio terminal Ganho — dispara também
          // "mudança de fase" pra automações "quando entra na fase X".
          notifyDealStageChanged(deal.id, deal.stageId, updated.stageId).catch(() => {});
          affected++;
        }
      }

      if (action === "mark_lost") {
        const lostReason = typeof body.lostReason === "string" ? body.lostReason.trim() : "";

        const deals = await prisma.deal.findMany({
          where: { id: { in: dealIds }, status: { not: "LOST" } },
          select: {
            id: true,
            status: true,
            stageId: true,
            stage: { select: { pipelineId: true } },
          },
        });

        // Obrigatoriedade por funil — se qualquer deal estiver em funil
        // com lossReasonRequired, exige motivo.
        if (!lostReason && deals.length > 0) {
          const pipeIds = [...new Set(deals.map((d) => d.stage.pipelineId))];
          const requiredPipes = await prisma.pipeline.findMany({
            where: { id: { in: pipeIds }, lossReasonRequired: true },
            select: { id: true },
          });
          if (requiredPipes.length > 0) {
            return NextResponse.json(
              { message: "Motivo da perda é obrigatório neste funil." },
              { status: 400 },
            );
          }
        }

        // Gate "Permitir outro" — valida contra o catálogo/vínculo do funil
        // de cada deal (falha o bulk inteiro antes do loop).
        if (lostReason) {
          try {
            for (const d of deals) {
              await assertLostReasonAllowed(lostReason, d.stage.pipelineId);
            }
          } catch (err) {
            if (err instanceof Error && err.message === "INVALID_LOST_REASON") {
              return NextResponse.json(
                {
                  message:
                    "Motivo da perda inválido. Selecione um dos motivos cadastrados em Configurações → Motivos de perda.",
                },
                { status: 400 },
              );
            }
            throw err;
          }
        }
        for (const deal of deals) {
          const updated = await markDealLost(deal.id, lostReason);
          createDealEvent(deal.id, uid, "STATUS_CHANGED", { from: deal.status, to: "LOST", lostReason }).catch(() => {});
          fireTrigger("deal_lost", { dealId: deal.id, data: { fromStatus: deal.status, lostReason } }).catch(() => {});
          // markDealLost move pro estágio terminal Perdido — dispara também
          // "mudança de fase" pra automações "quando entra na fase X".
          notifyDealStageChanged(deal.id, deal.stageId, updated.stageId).catch(() => {});
          affected++;
        }
      }

      if (action === "delete") {
        const result = await prisma.deal.deleteMany({ where: { id: { in: dealIds } } });
        affected = result.count;
      }

      return NextResponse.json({ affected, action });
    } catch (e) {
      console.error(e);
      return NextResponse.json({ message: "Erro na ação em massa." }, { status: 500 });
    }
  });
}
