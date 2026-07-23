import type { Job } from "bullmq";

import { getLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/services/activity-log";
import type { BulkResolveConversationsPayload } from "@/lib/queue";

import {
  type BulkOperationErrorEntry,
  incrementOperationProgress,
  markOperationFailed,
  markOperationFinished,
  markOperationStarted,
  truncateErrorMessage,
} from "./_update-progress";

const log = getLogger("jobs.leads.bulk-resolve-conversations");

/**
 * Tamanho do chunk: 50 conversas. Cada chunk:
 *   1. Lê o estado atual (status) das conversas do chunk.
 *   2. `updateMany` para RESOLVED apenas nas que ainda não estão resolvidas.
 *   3. Emite ActivityLog CONVERSATION_CLOSED fire-and-forget por conversa alterada.
 *
 * Idempotência: conversa já RESOLVED conta como sucesso (noop) sem re-logar —
 * retries do BullMQ não duplicam eventos nem reencerram.
 */
const CHUNK_SIZE = 50;

/**
 * Handler do job `bulk-resolve-conversations` da fila `leads-bulk`.
 *
 * A rota produtora (`POST /api/conversations/bulk`) já:
 *   - aplicou o filtro de visibilidade do usuário nos ids;
 *   - removeu ids de departamentos que exigem tabulação ao encerrar;
 *   - leu as org settings keepAgent/keepDepartment.
 * Aqui confiamos no payload saneado — não relemos settings (evita acesso a
 * org-settings fora de RequestContext no worker).
 */
export async function processBulkResolveConversations(
  payload: BulkResolveConversationsPayload,
  job: Job<BulkResolveConversationsPayload>,
): Promise<void> {
  const { operationId, organizationId, conversationIds, keepAgent, keepDepartment } = payload;
  const ctx = log.child({
    operationId,
    organizationId,
    jobId: job.id,
    attempt: job.attemptsMade + 1,
    conversationCount: conversationIds.length,
  });
  ctx.info("Iniciando bulk-resolve-conversations");

  if (conversationIds.length === 0) {
    await markOperationFailed(operationId, organizationId, "conversationIds vazio");
    ctx.warn("Payload vazio — operação marcada como FAILED");
    return;
  }

  await markOperationStarted(operationId, organizationId);

  for (let i = 0; i < conversationIds.length; i += CHUNK_SIZE) {
    const chunkIds = conversationIds.slice(i, i + CHUNK_SIZE);
    const chunkLog = ctx.child({
      chunkIndex: Math.floor(i / CHUNK_SIZE),
      chunkSize: chunkIds.length,
    });

    let chunkErrors: BulkOperationErrorEntry[] = [];
    let chunkSucceeded = 0;
    let chunkFailed = 0;

    try {
      const convs = await prisma.conversation.findMany({
        where: { id: { in: chunkIds } },
        select: {
          id: true,
          status: true,
          contactId: true,
          contact: { select: { name: true } },
        },
      });

      const found = new Set(convs.map((c) => c.id));
      const missing = chunkIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        const now = new Date().toISOString();
        chunkFailed += missing.length;
        chunkErrors.push(
          ...missing.map((conversationId) => ({
            itemId: conversationId,
            message: "Conversa não encontrada ou não pertence à organização",
            attempt: job.attemptsMade + 1,
            at: now,
          })),
        );
      }

      const toResolve = convs.filter((c) => c.status !== "RESOLVED");
      const noOps = convs.filter((c) => c.status === "RESOLVED");
      chunkSucceeded += noOps.length; // já encerrada = sucesso idempotente.

      if (toResolve.length > 0) {
        await prisma.conversation.updateMany({
          where: {
            id: { in: toResolve.map((c) => c.id) },
            status: { not: "RESOLVED" }, // defesa contra concorrência
          },
          data: {
            status: "RESOLVED",
            closedAt: new Date(),
            ...(keepAgent ? {} : { assignedToId: null }),
            ...(keepDepartment ? {} : { departmentId: null }),
          },
        });
        chunkSucceeded += toResolve.length;

        for (const conv of toResolve) {
          logEvent({
            type: "CONVERSATION_CLOSED",
            entityType: "CONVERSATION",
            entityId: conv.id,
            entityLabel: conv.contact?.name ?? null,
            conversationId: conv.id,
            contactId: conv.contactId,
            field: "status",
            oldValue: conv.status,
            newValue: "RESOLVED",
            meta: { from: conv.status, to: "RESOLVED", source: "bulk-async" },
          }).catch((err: unknown) => {
            chunkLog.warn(
              { conversationId: conv.id, err: truncateErrorMessage(err) },
              "logEvent CONVERSATION_CLOSED falhou (fire-and-forget)",
            );
          });
        }
      }

      chunkLog.info(
        { resolved: toResolve.length, noOps: noOps.length, missing: missing.length },
        "Chunk processado",
      );
    } catch (err) {
      chunkFailed += chunkIds.length - chunkSucceeded - chunkErrors.length;
      const errMsg = truncateErrorMessage(err);
      const now = new Date().toISOString();
      chunkErrors = chunkErrors.concat(
        chunkIds
          .filter((id) => !chunkErrors.some((e) => e.itemId === id))
          .map((conversationId) => ({
            itemId: conversationId,
            message: errMsg,
            attempt: job.attemptsMade + 1,
            at: now,
          })),
      );
      chunkLog.error({ err }, "Chunk falhou — itens marcados como erro");
    }

    await incrementOperationProgress(
      operationId,
      organizationId,
      {
        processed: chunkIds.length,
        succeeded: chunkSucceeded,
        failed: chunkFailed,
      },
      chunkErrors.length > 0 ? chunkErrors : undefined,
    );
  }

  await markOperationFinished(operationId, organizationId);
  ctx.info("bulk-resolve-conversations finalizado");
}
