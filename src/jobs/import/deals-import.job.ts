import type { Job } from "bullmq";

import {
  buildDealCustomFieldMap,
  newDealImportCache,
  preloadContactsForChunk,
  preloadOwnersByEmail,
  preloadStages,
  processDealRow,
  validateDealImportHeaders,
  type DealImportOptions,
} from "@/lib/deal-import-core";
import { readTableFromBuffer, upsertImportTag } from "@/lib/import-helpers";
import { getLogger } from "@/lib/logger";
import { prismaBase } from "@/lib/prisma-base";
import { getOrgIdOrThrow } from "@/lib/request-context";
import { getCustomFields } from "@/services/custom-fields";
import { readStoredFile } from "@/lib/storage/local";
import type { DealImportPayload } from "@/lib/queue";

import {
  incrementOperationProgress,
  markOperationFailed,
  markOperationFinished,
  markOperationStarted,
  type BulkOperationErrorEntry,
} from "@/jobs/leads/_update-progress";

const log = getLogger("worker.etl.deal-import");

/**
 * Tamanho do chunk (T4): pré-carrega contatos do chunk em lote (IN) antes de
 * processar, e atualiza o progresso ao fim de cada chunk.
 */
const CHUNK_SIZE = 200;

function chunkSleepMs(): number {
  const raw = process.env.IMPORT_CHUNK_SLEEP_MS;
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Handler do job `deal-import` da fila `import-etl` (T3/M1). Antes o import de
 * negócios rodava SÍNCRONO dentro do request HTTP da API, ocupando um worker
 * Node compartilhado com os outros tenants. Agora processa no etl-worker
 * (processo/pool separado), em chunks com pré-carga em lote (T4).
 *
 * Roda dentro de `withSystemContext(organizationId)` (configurado pelo
 * etl-worker), então `prisma` scoped e `getOrgIdOrThrow()` funcionam.
 */
export async function processDealsImport(
  payload: DealImportPayload,
  job: Job<DealImportPayload>,
): Promise<void> {
  const { operationId, organizationId, fileName, originalName } = payload;
  const ctx = log.child({ operationId, organizationId, jobId: job.id });

  await markOperationStarted(operationId, organizationId);

  // 1. Conteúdo do arquivo: base64 embutido no BulkOperation.payload; fallback disco.
  let fileBuffer: Buffer | null = null;
  try {
    const op = await prismaBase.bulkOperation.findUnique({
      where: { id: operationId },
      select: { payload: true },
    });
    const opPayload = (op?.payload ?? null) as { fileContentB64?: unknown } | null;
    const b64 =
      typeof opPayload?.fileContentB64 === "string" ? opPayload.fileContentB64 : null;
    if (b64) fileBuffer = Buffer.from(b64, "base64");
  } catch (err) {
    ctx.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Falha ao ler conteúdo embutido — tentando storage em disco",
    );
  }

  if (!fileBuffer) {
    const stored = await readStoredFile(organizationId, "imports", fileName);
    if (stored) fileBuffer = stored.buffer;
  }

  if (!fileBuffer) {
    await markOperationFailed(
      operationId,
      organizationId,
      `Conteúdo da importação não encontrado (nem embutido no banco nem no storage: imports/${fileName}).`,
    );
    ctx.error("Conteúdo do arquivo não encontrado — abortando");
    return;
  }

  // 2. Parse (CSV/XLSX).
  let headers: string[];
  let rows: Record<string, string>[];
  try {
    const parsed = await readTableFromBuffer(fileBuffer, originalName, payload.delimiter);
    headers = parsed.headers;
    rows = parsed.rows;
  } catch (err) {
    await markOperationFailed(
      operationId,
      organizationId,
      `Falha ao ler o arquivo: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  const headerError = validateDealImportHeaders(headers);
  if (headerError) {
    await markOperationFailed(operationId, organizationId, headerError);
    return;
  }

  // 3. Tag opcional (uma vez).
  let importTagId: string | null = null;
  if (payload.tagName) {
    try {
      importTagId = await upsertImportTag(getOrgIdOrThrow(), payload.tagName);
    } catch {
      importTagId = null;
    }
  }

  // 4. Mapa de campos personalizados de negócio.
  let dealCustomFieldMap: Map<string, string> | undefined;
  try {
    const defs = (await getCustomFields("deal")) as Array<{
      id: string;
      name: string;
      label?: string | null;
    }>;
    dealCustomFieldMap = await buildDealCustomFieldMap(headers, defs);
  } catch (err) {
    ctx.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Falha ao carregar campos personalizados de negócio — seguindo sem eles",
    );
  }

  const opts: DealImportOptions = {
    updateExisting: payload.updateExisting,
    importTagId,
    dealCustomFieldMap,
  };

  // 5. Pré-carga global (T4): stages da org (1x) + owners por e-mail (lote).
  const cache = newDealImportCache();
  try {
    await preloadStages(cache);
  } catch (err) {
    ctx.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Falha ao pré-carregar stages — resolução cairá no fallback por linha",
    );
  }
  try {
    const ownerEmails = rows
      .map((r) => (r.owner_email?.trim() || r.owneremail?.trim() || ""))
      .filter(Boolean);
    if (ownerEmails.length > 0) await preloadOwnersByEmail(ownerEmails, cache);
  } catch {
    // fallback por linha
  }

  // 6. Processa em chunks; pré-carrega contatos do chunk antes do loop.
  const pause = chunkSleepMs();
  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const chunk = rows.slice(start, start + CHUNK_SIZE);

    try {
      await preloadContactsForChunk(chunk, cache);
    } catch {
      // fallback por linha (resolveContactIdForDeal consulta o banco no miss)
    }

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    const errors: BulkOperationErrorEntry[] = [];

    for (let i = 0; i < chunk.length; i++) {
      const rowNumber = start + i + 2; // +1 cabeçalho, +1 base-1
      let result;
      try {
        result = await processDealRow(headers, chunk[i], opts, cache);
      } catch (err) {
        result = {
          status: "failed" as const,
          message: err instanceof Error ? err.message : "Erro inesperado na linha.",
        };
      }

      processed += 1;
      if (result.status === "failed") {
        failed += 1;
        errors.push({
          itemId: `row-${rowNumber}`,
          message: result.message.slice(0, 500),
          attempt: job.attemptsMade + 1,
          at: new Date().toISOString(),
        });
      } else {
        // created | updated | skipped → todos contam como "processados com sucesso"
        succeeded += 1;
      }
    }

    await incrementOperationProgress(
      operationId,
      organizationId,
      { processed, succeeded, failed },
      errors,
    );

    if (pause > 0) await sleep(pause);
  }

  await markOperationFinished(operationId, organizationId);
  ctx.info({ totalRows: rows.length }, "Importação de negócios concluída");
}
