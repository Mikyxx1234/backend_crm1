import { Queue } from "bullmq";
import IORedis from "ioredis";

export const AUTOMATION_JOBS_QUEUE_NAME = "automation-jobs" as const;
export const BAILEYS_OUTBOUND_QUEUE_NAME = "baileys-outbound" as const;
export const BAILEYS_CONTROL_QUEUE_NAME = "baileys-control" as const;
export const CAMPAIGN_DISPATCH_QUEUE_NAME = "campaign-dispatch" as const;
export const CAMPAIGN_SEND_QUEUE_NAME = "campaign-send" as const;

const AUTOMATION_JOB_NAME = "run" as const;

export type AutomationJobContext = {
  contactId?: string;
  dealId?: string;
  event: string;
  data?: unknown;
};

export type AutomationJobPayload = {
  automationId: string;
  context: AutomationJobContext;
};

export type BaileysOutboundPayload = {
  channelId: string;
  to: string;
  content: string;
  mediaUrl?: string;
  replyTo?: string;
  messageType: string;
  conversationId: string;
  messageId: string;
};

export type BaileysControlPayload = {
  channelId: string;
  action: "connect" | "disconnect" | "logout";
};

export type CampaignDispatchPayload = {
  campaignId: string;
};

export type CampaignSendPayload = {
  campaignId: string;
  recipientId: string;
  contactId: string;
  contactPhone: string;
  contactBsuid?: string;
};

const redisUrl = process.env.REDIS_URL;

const globalForQueue = globalThis as unknown as {
  automationQueueRedis?: IORedis;
  automationQueue?: Queue<AutomationJobPayload>;
  baileysOutboundQueue?: Queue<BaileysOutboundPayload>;
  baileysControlQueue?: Queue<BaileysControlPayload>;
  campaignDispatchQueue?: Queue<CampaignDispatchPayload>;
  campaignSendQueue?: Queue<CampaignSendPayload>;
};

function getQueueRedis(): IORedis | null {
  if (!redisUrl) return null;
  if (!globalForQueue.automationQueueRedis) {
    globalForQueue.automationQueueRedis = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
    });
  }
  return globalForQueue.automationQueueRedis;
}

function getQueue(): Queue<AutomationJobPayload> | null {
  const redis = getQueueRedis();
  if (!redis) return null;
  if (!globalForQueue.automationQueue) {
    globalForQueue.automationQueue = new Queue<AutomationJobPayload>(AUTOMATION_JOBS_QUEUE_NAME, {
      connection: redis,
    });
  }
  return globalForQueue.automationQueue;
}

export async function enqueueAutomationJob(payload: AutomationJobPayload) {
  const workerMode = process.env.AUTOMATION_WORKER_MODE?.trim().toLowerCase();
  console.info(`[queue] enqueueAutomationJob — automationId=${payload.automationId} workerMode=${workerMode ?? "(não definido)"} contactId=${payload.context.contactId ?? "—"} event=${payload.context.event}`);

  if (workerMode === "external") {
    const queue = getQueue();
    if (!queue) {
      console.warn(`[queue] AUTOMATION_WORKER_MODE=external mas Redis indisponível — fallback para execução direta`);
      try {
        await executeAutomationDirect(payload);
      } catch (err) {
        console.error("[queue] direct execution error (fallback):", err);
      }
      return null;
    }
    console.info(`[queue] Enfileirando automação ${payload.automationId} no BullMQ`);
    return queue.add(AUTOMATION_JOB_NAME, payload, {
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  console.info(`[queue] Executando automação ${payload.automationId} inline (sem worker externo)...`);
  const startMs = Date.now();
  try {
    await executeAutomationDirect(payload);
    console.info(`[queue] Automação ${payload.automationId} executada inline OK (${Date.now() - startMs}ms)`);
  } catch (err) {
    console.error(`[queue] ✗ Automação ${payload.automationId} FALHOU inline (${Date.now() - startMs}ms):`, err);
  }
  return null;
}

async function executeAutomationDirect(payload: AutomationJobPayload) {
  const { runAutomationInline } = await import("@/services/automation-executor");
  await runAutomationInline(payload);
}

// ── Baileys queues ──────────────────────────────────────

function getBaileysOutboundQueue(): Queue<BaileysOutboundPayload> | null {
  const redis = getQueueRedis();
  if (!redis) return null;
  if (!globalForQueue.baileysOutboundQueue) {
    globalForQueue.baileysOutboundQueue = new Queue<BaileysOutboundPayload>(
      BAILEYS_OUTBOUND_QUEUE_NAME,
      { connection: redis },
    );
  }
  return globalForQueue.baileysOutboundQueue;
}

function getBaileysControlQueue(): Queue<BaileysControlPayload> | null {
  const redis = getQueueRedis();
  if (!redis) return null;
  if (!globalForQueue.baileysControlQueue) {
    globalForQueue.baileysControlQueue = new Queue<BaileysControlPayload>(
      BAILEYS_CONTROL_QUEUE_NAME,
      { connection: redis },
    );
  }
  return globalForQueue.baileysControlQueue;
}

export async function enqueueBaileysOutbound(payload: BaileysOutboundPayload) {
  const queue = getBaileysOutboundQueue();
  if (!queue) {
    console.warn("[queue] Redis indisponível — não é possível enviar via Baileys");
    return null;
  }
  return queue.add("send", payload, {
    removeOnComplete: true,
    removeOnFail: false,
  });
}

export async function enqueueBaileysControl(payload: BaileysControlPayload) {
  const queue = getBaileysControlQueue();
  if (!queue) {
    console.warn("[queue] Redis indisponível — não é possível controlar sessão Baileys");
    return null;
  }
  return queue.add(payload.action, payload, {
    removeOnComplete: true,
    removeOnFail: false,
  });
}

// ── Campaign queues ──────────────────────────────────────

function getCampaignDispatchQueue(): Queue<CampaignDispatchPayload> | null {
  const redis = getQueueRedis();
  if (!redis) return null;
  if (!globalForQueue.campaignDispatchQueue) {
    globalForQueue.campaignDispatchQueue = new Queue<CampaignDispatchPayload>(
      CAMPAIGN_DISPATCH_QUEUE_NAME,
      { connection: redis },
    );
  }
  return globalForQueue.campaignDispatchQueue;
}

function getCampaignSendQueue(): Queue<CampaignSendPayload> | null {
  const redis = getQueueRedis();
  if (!redis) return null;
  if (!globalForQueue.campaignSendQueue) {
    globalForQueue.campaignSendQueue = new Queue<CampaignSendPayload>(
      CAMPAIGN_SEND_QUEUE_NAME,
      { connection: redis },
    );
  }
  return globalForQueue.campaignSendQueue;
}

export async function enqueueCampaignDispatch(payload: CampaignDispatchPayload, delay?: number) {
  const queue = getCampaignDispatchQueue();
  if (!queue) {
    console.warn("[queue] Redis indisponível — não é possível disparar campanha");
    return null;
  }
  return queue.add("dispatch", payload, {
    removeOnComplete: true,
    removeOnFail: false,
    ...(delay ? { delay } : {}),
  });
}

export async function enqueueCampaignSend(payload: CampaignSendPayload) {
  const queue = getCampaignSendQueue();
  if (!queue) {
    console.warn("[queue] Redis indisponível — não é possível enviar mensagem de campanha");
    return null;
  }
  return queue.add("send", payload, {
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 6,
    backoff: { type: "exponential", delay: 3000 },
  });
}
