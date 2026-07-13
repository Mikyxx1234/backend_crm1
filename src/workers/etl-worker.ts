import { Worker, type Job } from "bullmq";

import { getLogger } from "@/lib/logger";
import { prismaBase } from "@/lib/prisma-base";
import {
  duplicateBullConnection,
  getBullConnection,
} from "@/lib/queue-connection";
import {
  IMPORT_ETL_JOB_NAMES,
  IMPORT_ETL_QUEUE_NAME,
  type ContactImportPayload,
  type DealImportPayload,
  type ImportEtlPayload,
} from "@/lib/queue";
import { withSystemContext } from "@/lib/webhook-context";

import { processContactImport } from "@/jobs/import/contact-import.job";
import { processDealImport } from "@/jobs/import/deal-import.job";
import {
  markOperationFailed,
  truncateErrorMessage,
} from "@/jobs/leads/_update-progress";

const log = getLogger("worker.etl");

/**
 * Worker BullMQ que consome a fila `import-etl` (ETL de importação de
 * arquivos). Mesma arquitetura do leads-worker:
 *   - Roda fora de RequestContext → usa `withSystemContext(organizationId)`.
 *   - Re-valida o `BulkOperation` via `prismaBase` (defesa em profundidade).
 *   - Falhas por-linha viram entradas em `BulkOperation.errors` (handler),
 *     não causam retry do job inteiro.
 *
 * Lê os arquivos do bucket `imports` no volume compartilhado (mesmo
 * STORAGE_ROOT da API) via `readStoredFile` — por isso o serviço worker
 * precisa montar o MESMO volume de storage que a API.
 */

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultValue;
}

async function router(job: Job<ImportEtlPayload>): Promise<void> {
  const { operationId, organizationId } = job.data;
  const jobCtx = log.child({
    operationId,
    organizationId,
    jobId: job.id,
    jobName: job.name,
    attempt: job.attemptsMade + 1,
  });

  const operation = await prismaBase.bulkOperation.findUnique({
    where: { id: operationId },
    select: { id: true, organizationId: true, status: true, type: true },
  });

  if (!operation) {
    jobCtx.error("BulkOperation não encontrada — descartando job");
    throw new Error(`BulkOperation ${operationId} não encontrada`);
  }

  if (operation.organizationId !== organizationId) {
    jobCtx.error(
      { dbOrgId: operation.organizationId },
      "organizationId do payload diverge do BulkOperation",
    );
    await markOperationFailed(
      operationId,
      operation.organizationId,
      "organizationId do job não corresponde ao BulkOperation",
    );
    return;
  }

  if (
    operation.status === "COMPLETED" ||
    operation.status === "FAILED" ||
    operation.status === "PARTIAL" ||
    operation.status === "CANCELLED"
  ) {
    jobCtx.info(
      { dbStatus: operation.status },
      "BulkOperation já finalizada — ignorando job",
    );
    return;
  }

  await withSystemContext(organizationId, () => dispatch(job));
}

async function dispatch(job: Job<ImportEtlPayload>): Promise<void> {
  switch (job.name) {
    case IMPORT_ETL_JOB_NAMES.contactImport:
      await processContactImport(job.data as ContactImportPayload, job as Job<ContactImportPayload>);
      return;
    case IMPORT_ETL_JOB_NAMES.dealImport:
      await processDealImport(job.data as DealImportPayload, job as Job<DealImportPayload>);
      return;
    default: {
      const { operationId, organizationId } = job.data;
      await markOperationFailed(
        operationId,
        organizationId,
        `Job name desconhecido: ${job.name}`,
      );
      throw new Error(`[etl-worker] Job name desconhecido: ${job.name}`);
    }
  }
}

export function startEtlWorker() {
  const concurrency = envInt("IMPORT_ETL_CONCURRENCY", 2);
  const connection = duplicateBullConnection();
  getBullConnection();

  const worker = new Worker<ImportEtlPayload>(
    IMPORT_ETL_QUEUE_NAME,
    router,
    { connection, concurrency },
  );

  worker.on("completed", (job) => {
    log.info(
      {
        operationId: job.data.operationId,
        organizationId: job.data.organizationId,
        jobId: job.id,
        jobName: job.name,
      },
      "Job concluído",
    );
  });

  worker.on("failed", (job, err) => {
    log.error(
      {
        operationId: job?.data.operationId,
        organizationId: job?.data.organizationId,
        jobId: job?.id,
        jobName: job?.name,
        attempt: (job?.attemptsMade ?? 0) + 1,
        err: truncateErrorMessage(err),
      },
      "Job falhou",
    );
  });

  worker.on("error", (err) => {
    log.error({ err: truncateErrorMessage(err) }, "Worker error");
  });

  log.info({ concurrency, queue: IMPORT_ETL_QUEUE_NAME }, "etl-worker started");

  const shutdown = async (signal: string) => {
    log.info({ signal }, "Recebido sinal de shutdown — fechando worker");
    try {
      await worker.close();
    } catch (err) {
      log.error({ err: truncateErrorMessage(err) }, "Erro ao fechar worker");
    }
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  return worker;
}

// Bootstrap quando executado diretamente (npm script ou node dist/.../etl-worker.js).
if (require.main === module) {
  startEtlWorker();
}
