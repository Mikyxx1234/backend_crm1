import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";

import { prismaBase } from "@/lib/prisma-base";
import { runAutomationInline } from "@/services/automation-executor";
import { withSystemContext } from "@/lib/webhook-context";
import type { AutomationJobPayload } from "@/lib/queue";

const AUTOMATION_QUEUE_NAME = "automation-jobs";
const redisUrl = process.env.REDIS_URL;

/**
 * Resolve a organizationId da automação (sem scope) e roda
 * `runAutomationInline` dentro de `withSystemContext`. Sem isso, o
 * worker tenta usar `prisma` (com extensao de scope) sem
 * RequestContext e quebra com "[prisma] ... chamado fora de
 * RequestContext" — ou pior, executa sem o filtro de tenant.
 */
async function processAutomationJob(job: Job<AutomationJobPayload>) {
  const { automationId, context } = job.data;

  const automation = await prismaBase.automation.findUnique({
    where: { id: automationId },
    select: { organizationId: true },
  });

  if (!automation) {
    console.warn(
      `[automation-worker] Automação ${automationId} não encontrada — pulando job ${job.id}`,
    );
    return;
  }

  console.info(
    `[automation-worker] Processando job ${job.id} automation=${automationId} org=${automation.organizationId} event=${context.event}`,
  );

  await withSystemContext(automation.organizationId, async () => {
    await runAutomationInline(job.data);
  });
}

let workerStarted = false;

export function startAutomationWorker() {
  if (workerStarted) return;
  if (!redisUrl) {
    console.warn("[automation-worker] REDIS_URL not configured, worker disabled");
    return;
  }
  workerStarted = true;

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const worker = new Worker<AutomationJobPayload>(AUTOMATION_QUEUE_NAME, processAutomationJob, { connection });

  worker.on("failed", (job, err) => {
    console.error(`[automation-worker] job ${job?.id} falhou:`, err?.message);
  });
  worker.on("completed", (job) => {
    console.info(`[automation-worker] job ${job.id} concluído`);
  });

  console.info(`[automation-worker] Worker iniciado (in-process) ouvindo fila "${AUTOMATION_QUEUE_NAME}"`);
}
