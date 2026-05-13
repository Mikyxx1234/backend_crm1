import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";

import { runAutomationInline } from "@/services/automation-executor";
import type { AutomationJobPayload } from "@/lib/queue";

const AUTOMATION_QUEUE_NAME = "automation-jobs";
const redisUrl = process.env.REDIS_URL;

async function processAutomationJob(job: Job<AutomationJobPayload>) {
  const { automationId, context } = job.data;
  console.info(`[automation-worker] Processando job ${job.id} para automação ${automationId} (evento: ${context.event})`);
  await runAutomationInline(job.data);
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
