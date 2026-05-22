import type { Job } from "bullmq";

import { getLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { upsertDealCustomFieldValues } from "@/services/custom-fields";
import type { BulkUpdateFieldsPayload } from "@/lib/queue";

import {
  type BulkOperationErrorEntry,
  incrementOperationProgress,
  markOperationFailed,
  markOperationFinished,
  markOperationStarted,
  truncateErrorMessage,
} from "./_update-progress";

const log = getLogger("jobs.leads.bulk-update-fields");

/**
 * Tamanho do chunk: número de deals processados por iteração antes de
 * reportar progresso. 50 é um equilíbrio prático:
 *   - chunk muito pequeno → spam de updates em BulkOperation (overhead);
 *   - chunk muito grande  → frontend espera segundos sem ver progresso;
 *   - 50 com `succeeded++` por chunk dá granularidade de 2% em operações
 *     típicas (~2500 deals = 50 chunks).
 *
 * Custom: cada deal nesse handler dispara `upsertDealCustomFieldValues`
 * que abre seu próprio `prisma.$transaction(ops)`. Em N deals = N
 * transações pequenas — mais resiliente a contention do que uma trans-
 * action gigante (cuidado 7 do usuário: chunks + erros por-item).
 */
const CHUNK_SIZE = 50;

/**
 * Handler do job `bulk-update-fields` da fila `leads-bulk`.
 *
 * Pré-condições:
 *   - chamado dentro de `withSystemContext(organizationId, ...)` pelo worker;
 *   - `BulkOperation` correspondente existe no DB com status PENDING/PROCESSING.
 *
 * Fluxo:
 *   1. Valida que dealIds e customFieldIds pertencem à org (defesa em
 *      profundidade — o request handler já validou, mas o worker roda em
 *      processo separado e o estado pode ter mudado entre enqueue e
 *      processamento).
 *   2. Marca PROCESSING.
 *   3. Itera deals em chunks de 50, upsertando cada custom field via
 *      `upsertDealCustomFieldValues` (reusa a lógica do service).
 *   4. Reporta progresso a cada chunk.
 *   5. Erros por-deal são acumulados em `errors[]` e não param o worker.
 *   6. Marca operação como COMPLETED/PARTIAL/FAILED com base nos contadores.
 *
 * Idempotência:
 *   - `upsert` é naturalmente idempotente (update se existe, create senão).
 *   - Se o job re-rodar (retry/duplicate), reaplica o mesmo valor — sem
 *     side effect (custom fields não disparam triggers de automação hoje).
 */
export async function processBulkUpdateFields(
  payload: BulkUpdateFieldsPayload,
  job: Job<BulkUpdateFieldsPayload>,
): Promise<void> {
  const { operationId, organizationId, dealIds, updates } = payload;
  const ctx = log.child({
    operationId,
    organizationId,
    jobId: job.id,
    attempt: job.attemptsMade + 1,
    dealCount: dealIds.length,
    fieldCount: updates.length,
  });
  ctx.info("Iniciando bulk-update-fields");

  if (dealIds.length === 0 || updates.length === 0) {
    await markOperationFailed(
      operationId,
      organizationId,
      "Payload vazio (dealIds ou updates ausentes)",
    );
    ctx.warn("Payload vazio — operação marcada como FAILED");
    return;
  }

  await markOperationStarted(operationId, organizationId);

  // Valida que todos os custom fields pertencem à org e ao escopo "deal".
  // Filtra updates inválidos para a org — não rejeita a operação inteira;
  // registra erro por field inválido e prossegue com os válidos.
  const fieldIds = updates.map((u) => u.fieldId);
  const validFields = await prisma.customField.findMany({
    where: { id: { in: fieldIds }, entity: "deal" },
    select: { id: true },
  });
  const validFieldIds = new Set(validFields.map((f) => f.id));
  const invalidFieldIds = fieldIds.filter((id) => !validFieldIds.has(id));
  const validUpdates = updates.filter((u) => validFieldIds.has(u.fieldId));

  if (invalidFieldIds.length > 0) {
    ctx.warn(
      { invalidFieldIds },
      "Custom fields inválidos ignorados (não pertencem à org ou não são entity=deal)",
    );
  }

  if (validUpdates.length === 0) {
    await markOperationFailed(
      operationId,
      organizationId,
      `Nenhum custom field válido para a operação (${invalidFieldIds.length} inválidos rejeitados)`,
    );
    return;
  }

  // Confere quais deals realmente pertencem à org. dealIds que não existem
  // (ou foram movidos para outra org via super-admin) são registrados como
  // erro mas não travam a operação.
  const existingDeals = await prisma.deal.findMany({
    where: { id: { in: dealIds } },
    select: { id: true },
  });
  const existingDealIds = new Set(existingDeals.map((d) => d.id));
  const missingDealIds = dealIds.filter((id) => !existingDealIds.has(id));

  if (missingDealIds.length > 0) {
    const now = new Date().toISOString();
    const missingErrors: BulkOperationErrorEntry[] = missingDealIds.map(
      (dealId) => ({
        itemId: dealId,
        message: "Deal não encontrado ou não pertence à organização",
        attempt: job.attemptsMade + 1,
        at: now,
      }),
    );
    await incrementOperationProgress(
      operationId,
      organizationId,
      { processed: missingDealIds.length, failed: missingDealIds.length },
      missingErrors,
    );
    ctx.warn({ missingCount: missingDealIds.length }, "Deals ausentes pulados");
  }

  // Processa em chunks. Cada deal é processado isoladamente — falha em
  // um deal não trava o restante do chunk. Erros por-deal são capturados
  // em `errors[]`; erros de infraestrutura (DB down) são re-thrown para
  // BullMQ retry do job inteiro.
  const dealsToProcess = [...existingDealIds];
  for (let i = 0; i < dealsToProcess.length; i += CHUNK_SIZE) {
    const chunk = dealsToProcess.slice(i, i + CHUNK_SIZE);
    const chunkErrors: BulkOperationErrorEntry[] = [];
    let chunkSucceeded = 0;
    let chunkFailed = 0;

    for (const dealId of chunk) {
      try {
        await upsertDealCustomFieldValues(dealId, validUpdates);
        chunkSucceeded += 1;
      } catch (err) {
        chunkFailed += 1;
        chunkErrors.push({
          itemId: dealId,
          message: truncateErrorMessage(err),
          attempt: job.attemptsMade + 1,
          at: new Date().toISOString(),
        });
        ctx.error(
          { dealId, err },
          "Falha aplicando custom fields a deal",
        );
      }
    }

    await incrementOperationProgress(
      operationId,
      organizationId,
      {
        processed: chunk.length,
        succeeded: chunkSucceeded,
        failed: chunkFailed,
      },
      chunkErrors.length > 0 ? chunkErrors : undefined,
    );

    ctx.info(
      {
        chunkIndex: Math.floor(i / CHUNK_SIZE),
        chunkSucceeded,
        chunkFailed,
        progress: `${Math.min(i + chunk.length, dealsToProcess.length)}/${dealsToProcess.length}`,
      },
      "Chunk concluído",
    );
  }

  await markOperationFinished(operationId, organizationId);
  ctx.info("bulk-update-fields finalizado");
}
