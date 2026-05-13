import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";

import { prisma } from "@/lib/prisma";
import { runAutomationInline } from "@/services/automation-executor";
import type { AutomationJobPayload } from "@/lib/queue";

const AUTOMATION_QUEUE_NAME = "automation-jobs";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

async function processAutomationJob(job: Job<AutomationJobPayload>) {
  const { automationId, context } = job.data;
  console.info(`[automation-worker] Processando job ${job.id} para automação ${automationId} (evento: ${context.event})`);
  await runAutomationInline(job.data);
}

const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

const worker = new Worker<AutomationJobPayload>(AUTOMATION_QUEUE_NAME, processAutomationJob, {
  connection,
});

worker.on("failed", (job, err) => {
  console.error(`[automation-worker] job ${job?.id} falhou`, err);
});

worker.on("completed", (job) => {
  console.info(`[automation-worker] job ${job.id} concluído`);
});

async function shutdown() {
  await worker.close();
  await connection.quit();
  await prisma.$disconnect();
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});

console.info(`[automation-worker] ouvindo fila "${AUTOMATION_QUEUE_NAME}" em ${redisUrl}`);
