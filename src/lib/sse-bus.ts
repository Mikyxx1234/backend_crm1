import IORedis from "ioredis";

type Listener = (event: string, data: unknown) => void;

const REDIS_CHANNEL = "crm:sse:events";

function sseRedisPubSubEnabled(): boolean {
  return process.env.SSE_ENABLE_REDIS_PUBSUB === "1" && Boolean(process.env.REDIS_URL?.trim());
}

/**
 * Fan-out de eventos para clientes SSE.
 * - Modo default (sem Redis): só processo local (uma réplica Next).
 * - Com SSE_ENABLE_REDIS_PUBSUB=1 e REDIS_URL: publica no Redis; cada réplica subscreve e notifica os seus listeners (várias instâncias).
 */
class SseBus {
  private listeners = new Set<Listener>();
  private redisPub: IORedis | null = null;
  private redisSub: IORedis | null = null;
  private redisReady = false;
  private redisInitPromise: Promise<void> | null = null;

  private async ensureRedis(): Promise<void> {
    if (!sseRedisPubSubEnabled()) return;
    if (this.redisReady) return;
    if (this.redisInitPromise) return this.redisInitPromise;

    const url = process.env.REDIS_URL!.trim();
    this.redisInitPromise = (async () => {
      this.redisSub = new IORedis(url, { maxRetriesPerRequest: null });
      this.redisPub = new IORedis(url, { maxRetriesPerRequest: null });
      await this.redisSub.subscribe(REDIS_CHANNEL);
      this.redisSub.on("message", (_ch, msg) => {
        try {
          const parsed = JSON.parse(msg) as { event?: string; data?: unknown };
          if (typeof parsed.event !== "string") return;
          for (const listener of this.listeners) {
            try {
              listener(parsed.event, parsed.data);
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore malformed */
        }
      });
      this.redisReady = true;
    })();

    try {
      await this.redisInitPromise;
    } catch (e) {
      console.error("[sse-bus] falha ao ligar Redis pub/sub:", e);
      this.redisInitPromise = null;
      this.redisReady = false;
      this.redisSub?.disconnect();
      this.redisPub?.disconnect();
      this.redisSub = null;
      this.redisPub = null;
      throw e;
    }
  }

  subscribe(listener: Listener) {
    if (sseRedisPubSubEnabled()) {
      void this.ensureRedis().catch(() => {
        /* já logado */
      });
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: string, data: unknown) {
    if (sseRedisPubSubEnabled()) {
      void (async () => {
        try {
          await this.ensureRedis();
          if (!this.redisPub) return;
          const payload = JSON.stringify({ event, data });
          await this.redisPub.publish(REDIS_CHANNEL, payload);
        } catch (e) {
          console.error("[sse-bus] publish Redis:", e);
        }
      })();
      return;
    }

    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch {
        /* ignore */
      }
    }
  }
}

export const sseBus = new SseBus();

// Lazily start background services on first module load.
// This runs server-side only (sse-bus is never imported by client components).
let _bootstrapped = false;
function bootstrapBackgroundServices() {
  if (_bootstrapped) return;
  _bootstrapped = true;

  import("@/services/automation-context")
    .then(({ startTimeoutSweeper }) => startTimeoutSweeper())
    .catch((e) => console.error("[sse-bus] failed to start timeout sweeper:", e));

  import("@/services/presence-reaper")
    .then(({ startPresenceReaper }) => startPresenceReaper())
    .catch((e) => console.error("[sse-bus] failed to start presence reaper:", e));

  import("@/services/scheduled-messages-worker")
    .then(({ startScheduledMessagesWorker }) => startScheduledMessagesWorker())
    .catch((e) =>
      console.error("[sse-bus] failed to start scheduled-messages worker:", e),
    );

  import("@/services/stale-outbound-sweeper")
    .then(({ startStaleOutboundSweeper }) => startStaleOutboundSweeper())
    .catch((e) =>
      console.error("[sse-bus] failed to start stale outbound sweeper:", e),
    );

  import("@/services/ai-agent-inactivity-worker")
    .then(({ startAIAgentInactivityWorker }) => startAIAgentInactivityWorker())
    .catch((e) =>
      console.error("[sse-bus] failed to start ai-agent inactivity worker:", e),
    );
}
bootstrapBackgroundServices();
