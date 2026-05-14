/**
 * Métricas Prometheus do CRM (PR 2.2).
 *
 * Registry singleton centralizado pra evitar duplicação de Counter/Histogram
 * por hot-reload do Next.js (que recarrega módulos no dev).
 *
 * Métricas expostas em `GET /api/metrics` (autenticado por `METRICS_TOKEN`)
 * no formato text/plain Prometheus 0.0.4. Promtail/scraper Prometheus puxa
 * a cada 15s. Cardinalidade controlada — `route` é o template (`/api/conversations/:id`),
 * NÃO o path concreto, pra não explodir séries por id.
 *
 * Uso típico nos call-sites:
 *   import { metrics } from "@/lib/metrics";
 *   metrics.http.requests.inc({ route, method, status, organization });
 *   metrics.http.duration.observe({ route, method, status }, durationSec);
 *   const end = metrics.http.duration.startTimer({ route, method });
 *   // ... handler ...
 *   end({ status: "200" });
 *
 * Para métricas custom novas, registre aqui (não no call-site) — assim a doc
 * fica concentrada e quem opera o Grafana sabe exatamente onde olhar.
 */

import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";

const globalKey = Symbol.for("crm-eduit.metrics-registry");
type GlobalWithRegistry = typeof globalThis & {
  [K in typeof globalKey]?: {
    registry: Registry;
    metrics: AppMetrics;
  };
};

const g = globalThis as GlobalWithRegistry;

function buildMetrics(registry: Registry): AppMetrics {
  collectDefaultMetrics({ register: registry, prefix: "crm_" });

  const httpRequests = new Counter({
    name: "crm_http_requests_total",
    help: "Total HTTP requests recebidas pelo Next handler.",
    labelNames: ["route", "method", "status", "organization"] as const,
    registers: [registry],
  });

  const httpDuration = new Histogram({
    name: "crm_http_request_duration_seconds",
    help: "Latência ponta-a-ponta do handler HTTP (segundos).",
    labelNames: ["route", "method", "status"] as const,
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
    registers: [registry],
  });

  const sseSubscribers = new Gauge({
    name: "crm_sse_subscribers",
    help: "Clientes SSE conectados no momento (por organização).",
    labelNames: ["organization", "channel"] as const,
    registers: [registry],
  });

  const sseMessages = new Counter({
    name: "crm_sse_messages_total",
    help: "Eventos SSE publicados (após filtro tenant).",
    labelNames: ["event", "organization"] as const,
    registers: [registry],
  });

  const bullmqJobs = new Counter({
    name: "crm_bullmq_jobs_total",
    help: "Jobs BullMQ por status terminal.",
    labelNames: ["queue", "status"] as const,
    registers: [registry],
  });

  const bullmqDuration = new Histogram({
    name: "crm_bullmq_job_duration_seconds",
    help: "Tempo de execução de jobs BullMQ (segundos).",
    labelNames: ["queue", "status"] as const,
    buckets: [0.05, 0.1, 0.5, 1, 5, 15, 60, 300],
    registers: [registry],
  });

  const metaApi = new Counter({
    name: "crm_meta_api_calls_total",
    help: "Chamadas à API da Meta (Graph) — por endpoint e status.",
    labelNames: ["endpoint", "status", "organization"] as const,
    registers: [registry],
  });

  const metaApiDuration = new Histogram({
    name: "crm_meta_api_duration_seconds",
    help: "Latência de chamadas à API da Meta (segundos).",
    labelNames: ["endpoint", "status"] as const,
    buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10, 30],
    registers: [registry],
  });

  const inboundMessages = new Counter({
    name: "crm_inbound_messages_total",
    help: "Mensagens inbound processadas (webhook Meta + Baileys).",
    labelNames: ["channel_provider", "organization"] as const,
    registers: [registry],
  });

  const outboundMessages = new Counter({
    name: "crm_outbound_messages_total",
    help: "Mensagens outbound entregues à API.",
    labelNames: ["channel_provider", "status", "organization"] as const,
    registers: [registry],
  });

  const aiTokens = new Counter({
    name: "crm_ai_tokens_total",
    help: "Tokens consumidos por modelo AI (in/out).",
    labelNames: ["provider", "model", "kind", "organization"] as const,
    registers: [registry],
  });

  const dbQueries = new Histogram({
    name: "crm_db_query_duration_seconds",
    help: "Duração de queries Prisma (segundos).",
    labelNames: ["model", "action"] as const,
    buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [registry],
  });

  const errors = new Counter({
    name: "crm_errors_total",
    help: "Erros nominados por escopo (logger.error).",
    labelNames: ["scope", "kind"] as const,
    registers: [registry],
  });

  // Cache (PR 5.1) — hits/misses por namespace (channel, ai_agent, org).
  // Usado pra decidir se o TTL atual e bom ou se hot-keys merecem
  // pre-warming.
  const cacheHits = new Counter({
    name: "crm_cache_hits_total",
    help: "Cache hits por namespace de chave.",
    labelNames: ["key"] as const,
    registers: [registry],
  });

  const cacheMisses = new Counter({
    name: "crm_cache_misses_total",
    help: "Cache misses por namespace de chave (forcou loader).",
    labelNames: ["key"] as const,
    registers: [registry],
  });

  return {
    http: { requests: httpRequests, duration: httpDuration },
    sse: { subscribers: sseSubscribers, messages: sseMessages },
    bullmq: { jobs: bullmqJobs, duration: bullmqDuration },
    meta: { calls: metaApi, duration: metaApiDuration },
    messages: { inbound: inboundMessages, outbound: outboundMessages },
    ai: { tokens: aiTokens },
    db: { queries: dbQueries },
    errors,
    cacheHits,
    cacheMisses,
  };
}

export type AppMetrics = {
  http: {
    requests: Counter<"route" | "method" | "status" | "organization">;
    duration: Histogram<"route" | "method" | "status">;
  };
  sse: {
    subscribers: Gauge<"organization" | "channel">;
    messages: Counter<"event" | "organization">;
  };
  bullmq: {
    jobs: Counter<"queue" | "status">;
    duration: Histogram<"queue" | "status">;
  };
  meta: {
    calls: Counter<"endpoint" | "status" | "organization">;
    duration: Histogram<"endpoint" | "status">;
  };
  messages: {
    inbound: Counter<"channel_provider" | "organization">;
    outbound: Counter<"channel_provider" | "status" | "organization">;
  };
  ai: {
    tokens: Counter<"provider" | "model" | "kind" | "organization">;
  };
  db: {
    queries: Histogram<"model" | "action">;
  };
  errors: Counter<"scope" | "kind">;
  cacheHits: Counter<"key">;
  cacheMisses: Counter<"key">;
};

function ensureRegistry(): { registry: Registry; metrics: AppMetrics } {
  if (g[globalKey]) return g[globalKey]!;
  const registry = new Registry();
  registry.setDefaultLabels({ app: "crm-eduit" });
  const metrics = buildMetrics(registry);
  g[globalKey] = { registry, metrics };
  return g[globalKey]!;
}

export const registry: Registry = ensureRegistry().registry;
export const metrics: AppMetrics = ensureRegistry().metrics;

/**
 * Renderiza o snapshot atual no formato Prometheus exposition (text/plain).
 * Usado pelo endpoint `/api/metrics`.
 */
export async function renderMetrics(): Promise<{
  body: string;
  contentType: string;
}> {
  const body = await registry.metrics();
  return { body, contentType: registry.contentType };
}

/**
 * Helper resiliente para usar nas paths quentes — evita quebrar o handler
 * caso a label tenha valor null/undefined inesperado.
 */
export function safeLabel(v: unknown, fallback = "unknown"): string {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") return v.length > 0 ? v : fallback;
  return String(v);
}
