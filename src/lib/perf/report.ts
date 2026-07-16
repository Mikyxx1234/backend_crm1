/**
 * Perf report — consolida metricas do stack de monitoramento em um JSON
 * versionado (schemaVersion), consumivel por IAs para diagnosticar
 * dimensionamento e sugerir correcoes.
 *
 * Design:
 *   - **Sem side-effects na app**: leituras via HTTP API do Prometheus
 *     (PROMETHEUS_URL). Se o Prometheus nao estiver configurado, o report
 *     ainda funciona parcialmente (bloco `db` via pg direto).
 *   - **Somente leitura**: `recommendations[]` sao sugestoes maquina-legiveis;
 *     nao ha aplicacao automatica. Cada recomendacao carrega os campos
 *     necessarios para uma IA/humano decidir e executar.
 *
 * Contrato (v1):
 *   {
 *     schemaVersion: 1,
 *     generatedAt: ISO,
 *     window: { from: ISO, to: ISO, stepSec },
 *     envs: {
 *       [env]: {
 *         api:   { rps, p95Latency, errorRate, top5xxRoutes[] },
 *         ai:    { tokensPerMin, byModel[] },
 *         meta:  { callsPerMin, errorRate },
 *         queues:{ byQueue[]: {name,waiting,active,failed} },
 *         db:    { connectionsActive, cacheHitRatio, sizeBytes, slowQueries[] }
 *       }
 *     },
 *     containers: [
 *       { name, cpuPct, cpuPctPeak, memBytes, memBytesPeak, netRxBytesPerSec, netTxBytesPerSec, ioReadBytesPerSec, ioWriteBytesPerSec }
 *     ],
 *     host: { diskFreePctByMount[], load1, load5, load15, ioReadsPerSec, ioWritesPerSec },
 *     recommendations: Array<{
 *       id: string, target: string, metric: string, observed: number,
 *       threshold: number, severity: 'info'|'warning'|'critical',
 *       action: string, rationale: string
 *     }>
 *   }
 */

import { promInstant, promRange, seriesMax, isPromConfigured } from "@/lib/perf/prometheus-client";

export const PERF_REPORT_SCHEMA_VERSION = 1;

export type PerfRecommendation = {
  id: string;
  target: string;
  metric: string;
  observed: number;
  threshold: number;
  severity: "info" | "warning" | "critical";
  action: string;
  rationale: string;
};

export type ContainerStat = {
  name: string;
  cpuPct: number;
  cpuPctPeak: number;
  memBytes: number;
  memBytesPeak: number;
  netRxBytesPerSec: number;
  netTxBytesPerSec: number;
  ioReadBytesPerSec: number;
  ioWriteBytesPerSec: number;
};

export type EnvStats = {
  api: {
    rps: number;
    p95Latency: number;
    errorRate: number;
    top5xxRoutes: Array<{ route: string; rate: number }>;
  };
  ai: { tokensPerMin: number; byModel: Array<{ provider: string; model: string; tokensPerMin: number }> };
  meta: { callsPerMin: number; errorRate: number };
  queues: { byQueue: Array<{ name: string; waiting: number; active: number; failed: number }> };
  db: {
    connectionsActive: number;
    cacheHitRatio: number;
    sizeBytes: number;
    slowQueries: Array<{ query: string; calls: number; meanExecMs: number; totalExecMs: number }>;
  };
};

export type PerfReport = {
  schemaVersion: number;
  generatedAt: string;
  window: { from: string; to: string; stepSec: number };
  prometheusConfigured: boolean;
  envs: Record<string, EnvStats>;
  containers: ContainerStat[];
  host: {
    diskFreePctByMount: Array<{ mount: string; freePct: number }>;
    load1: number;
    load5: number;
    load15: number;
    ioReadsPerSec: number;
    ioWritesPerSec: number;
  };
  recommendations: PerfRecommendation[];
};

const DEFAULT_WINDOW_MIN = 60;

type BuildOpts = { windowMinutes?: number };

export async function buildPerfReport(opts: BuildOpts = {}): Promise<PerfReport> {
  const to = new Date();
  const windowMin = opts.windowMinutes ?? DEFAULT_WINDOW_MIN;
  const from = new Date(to.getTime() - windowMin * 60_000);
  const stepSec = Math.max(30, Math.round((windowMin * 60) / 60)); // ~60 pontos

  const promOk = isPromConfigured();

  const envs = promOk ? await collectEnvs(from, to, stepSec) : {};
  const containers = promOk ? await collectContainers(from, to, stepSec) : [];
  const host = promOk ? await collectHost() : emptyHost();
  const dbFallback = await collectDbFallback();

  // Merge fallback (via pg direto) — sobrescreve quando prom nao trouxe.
  for (const [env, snap] of Object.entries(dbFallback)) {
    envs[env] ??= emptyEnvStats();
    if (envs[env]!.db.slowQueries.length === 0) envs[env]!.db.slowQueries = snap.slowQueries;
  }

  const recommendations = deriveRecommendations({ envs, containers, host });

  return {
    schemaVersion: PERF_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    window: { from: from.toISOString(), to: to.toISOString(), stepSec },
    prometheusConfigured: promOk,
    envs,
    containers,
    host,
    recommendations,
  };
}

function emptyEnvStats(): EnvStats {
  return {
    api: { rps: 0, p95Latency: 0, errorRate: 0, top5xxRoutes: [] },
    ai: { tokensPerMin: 0, byModel: [] },
    meta: { callsPerMin: 0, errorRate: 0 },
    queues: { byQueue: [] },
    db: { connectionsActive: 0, cacheHitRatio: 0, sizeBytes: 0, slowQueries: [] },
  };
}

function emptyHost(): PerfReport["host"] {
  return {
    diskFreePctByMount: [],
    load1: 0,
    load5: 0,
    load15: 0,
    ioReadsPerSec: 0,
    ioWritesPerSec: 0,
  };
}

async function collectEnvs(from: Date, to: Date, stepSec: number): Promise<Record<string, EnvStats>> {
  const [
    rpsByEnv,
    p95ByEnv,
    errorRateByEnv,
    top5xx,
    aiTokensByEnvModel,
    metaCallsByEnv,
    metaErrByEnv,
    queueDepth,
    pgConns,
    pgCacheHit,
    pgSize,
  ] = await Promise.all([
    promInstant('sum by (env) (rate(crm_http_requests_total[5m]))'),
    promInstant('histogram_quantile(0.95, sum by (env, le) (rate(crm_http_request_duration_seconds_bucket[5m])))'),
    promInstant('sum by (env) (rate(crm_http_requests_total{status=~"5.."}[5m])) / clamp_min(sum by (env) (rate(crm_http_requests_total[5m])), 0.001)'),
    promInstant('topk(5, sum by (env, route) (rate(crm_http_requests_total{status=~"5.."}[5m])))'),
    promInstant('sum by (env, provider, model) (rate(crm_ai_tokens_total[5m])) * 60'),
    promInstant('sum by (env) (rate(crm_meta_api_calls_total[5m])) * 60'),
    promInstant('sum by (env) (rate(crm_meta_api_calls_total{status!~"2.."}[5m])) / clamp_min(sum by (env) (rate(crm_meta_api_calls_total[5m])), 0.001)'),
    promInstant('crm_bullmq_queue_depth'),
    promInstant('pg_stat_activity_count'),
    promInstant('sum by (env) (rate(pg_stat_database_blks_hit[5m])) / clamp_min(sum by (env) (rate(pg_stat_database_blks_hit[5m]) + rate(pg_stat_database_blks_read[5m])), 1)'),
    promInstant('pg_database_size_bytes'),
  ]);

  void from; void to; void stepSec;

  const envs: Record<string, EnvStats> = {};
  const ensure = (e: string) => (envs[e] ??= emptyEnvStats());

  for (const s of rpsByEnv) ensure(s.metric.env ?? "unknown").api.rps = s.value;
  for (const s of p95ByEnv) ensure(s.metric.env ?? "unknown").api.p95Latency = s.value;
  for (const s of errorRateByEnv) ensure(s.metric.env ?? "unknown").api.errorRate = s.value;

  for (const s of top5xx) {
    const env = s.metric.env ?? "unknown";
    ensure(env).api.top5xxRoutes.push({ route: s.metric.route ?? "?", rate: s.value });
  }

  const aiByEnv: Record<string, { tokensPerMin: number; byModel: EnvStats["ai"]["byModel"] }> = {};
  for (const s of aiTokensByEnvModel) {
    const env = s.metric.env ?? "unknown";
    (aiByEnv[env] ??= { tokensPerMin: 0, byModel: [] });
    aiByEnv[env]!.tokensPerMin += s.value;
    aiByEnv[env]!.byModel.push({
      provider: s.metric.provider ?? "?",
      model: s.metric.model ?? "?",
      tokensPerMin: s.value,
    });
  }
  for (const [env, ai] of Object.entries(aiByEnv)) ensure(env).ai = ai;

  for (const s of metaCallsByEnv) ensure(s.metric.env ?? "unknown").meta.callsPerMin = s.value;
  for (const s of metaErrByEnv) ensure(s.metric.env ?? "unknown").meta.errorRate = s.value;

  const queueMap: Record<string, Record<string, { name: string; waiting: number; active: number; failed: number }>> = {};
  for (const s of queueDepth) {
    const env = s.metric.env ?? "unknown";
    const name = s.metric.queue ?? "?";
    const state = s.metric.state ?? "?";
    (queueMap[env] ??= {});
    (queueMap[env]![name] ??= { name, waiting: 0, active: 0, failed: 0 });
    if (state === "waiting" || state === "active" || state === "failed") {
      queueMap[env]![name]![state] = s.value;
    }
  }
  for (const [env, qs] of Object.entries(queueMap)) ensure(env).queues.byQueue = Object.values(qs);

  for (const s of pgConns) ensure(s.metric.env ?? "unknown").db.connectionsActive = s.value;
  for (const s of pgCacheHit) ensure(s.metric.env ?? "unknown").db.cacheHitRatio = s.value;
  for (const s of pgSize) ensure(s.metric.env ?? "unknown").db.sizeBytes = s.value;

  return envs;
}

async function collectContainers(from: Date, to: Date, stepSec: number): Promise<ContainerStat[]> {
  const [cpu, cpuPeakSeries, mem, memPeakSeries, netRx, netTx, ioRead, ioWrite] = await Promise.all([
    promInstant('sum by (name) (rate(container_cpu_usage_seconds_total{name=~".+"}[5m])) * 100'),
    promRange('sum by (name) (rate(container_cpu_usage_seconds_total{name=~".+"}[5m])) * 100', { from, to, stepSec }),
    promInstant('container_memory_working_set_bytes{name=~".+"}'),
    promRange('container_memory_working_set_bytes{name=~".+"}', { from, to, stepSec }),
    promInstant('sum by (name) (rate(container_network_receive_bytes_total{name=~".+"}[5m]))'),
    promInstant('sum by (name) (rate(container_network_transmit_bytes_total{name=~".+"}[5m]))'),
    promInstant('sum by (name) (rate(container_fs_reads_bytes_total{name=~".+"}[5m]))'),
    promInstant('sum by (name) (rate(container_fs_writes_bytes_total{name=~".+"}[5m]))'),
  ]);

  const byName = new Map<string, ContainerStat>();
  const ensure = (n: string): ContainerStat => {
    let c = byName.get(n);
    if (!c) {
      c = {
        name: n,
        cpuPct: 0, cpuPctPeak: 0,
        memBytes: 0, memBytesPeak: 0,
        netRxBytesPerSec: 0, netTxBytesPerSec: 0,
        ioReadBytesPerSec: 0, ioWriteBytesPerSec: 0,
      };
      byName.set(n, c);
    }
    return c;
  };

  for (const s of cpu) ensure(s.metric.name ?? "?").cpuPct = s.value;
  for (const s of mem) ensure(s.metric.name ?? "?").memBytes = s.value;
  for (const s of netRx) ensure(s.metric.name ?? "?").netRxBytesPerSec = s.value;
  for (const s of netTx) ensure(s.metric.name ?? "?").netTxBytesPerSec = s.value;
  for (const s of ioRead) ensure(s.metric.name ?? "?").ioReadBytesPerSec = s.value;
  for (const s of ioWrite) ensure(s.metric.name ?? "?").ioWriteBytesPerSec = s.value;

  const peakByName = (series: typeof cpuPeakSeries): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const s of series) {
      const name = s.metric.name ?? "?";
      const localMax = seriesMax([s]);
      if (localMax > (out[name] ?? 0)) out[name] = localMax;
    }
    return out;
  };
  const cpuPeaks = peakByName(cpuPeakSeries);
  const memPeaks = peakByName(memPeakSeries);
  for (const [n, v] of Object.entries(cpuPeaks)) ensure(n).cpuPctPeak = v;
  for (const [n, v] of Object.entries(memPeaks)) ensure(n).memBytesPeak = v;

  return Array.from(byName.values()).sort((a, b) => b.cpuPct - a.cpuPct);
}

async function collectHost(): Promise<PerfReport["host"]> {
  const [disk, load1, load5, load15, iops_r, iops_w] = await Promise.all([
    promInstant('100 * (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"})'),
    promInstant('node_load1'),
    promInstant('node_load5'),
    promInstant('node_load15'),
    promInstant('sum(rate(node_disk_reads_completed_total[5m]))'),
    promInstant('sum(rate(node_disk_writes_completed_total[5m]))'),
  ]);

  return {
    diskFreePctByMount: disk.map((s) => ({ mount: s.metric.mountpoint ?? "?", freePct: s.value })),
    load1: load1[0]?.value ?? 0,
    load5: load5[0]?.value ?? 0,
    load15: load15[0]?.value ?? 0,
    ioReadsPerSec: iops_r[0]?.value ?? 0,
    ioWritesPerSec: iops_w[0]?.value ?? 0,
  };
}

/**
 * Fallback via Prisma direto quando o Prometheus nao tem dado de pg_*
 * (postgres-exporter nao configurado). Usa o mesmo padrao de
 * /api/admin/db-stats.
 *
 * Retorna por-env, mas so o env atual do processo — nao ha como saber
 * o do outro ambiente a partir do proprio backend.
 */
async function collectDbFallback(): Promise<Record<string, { slowQueries: EnvStats["db"]["slowQueries"] }>> {
  try {
    const { prismaBase } = await import("@/lib/prisma-base");
    const rows = await prismaBase.$queryRawUnsafe<Array<{
      query: string;
      calls: bigint;
      mean_exec_time_ms: number;
      total_exec_time_ms: number;
    }>>(`
      SELECT
        regexp_replace(query, '\\s+', ' ', 'g') AS query,
        calls::bigint AS calls,
        ROUND(mean_exec_time::numeric, 2)::float AS mean_exec_time_ms,
        ROUND(total_exec_time::numeric, 1)::float AS total_exec_time_ms
      FROM pg_stat_statements
      WHERE query NOT LIKE '%pg_stat_%'
        AND query NOT LIKE 'COMMIT%'
        AND query NOT LIKE 'BEGIN%'
        AND calls > 5
      ORDER BY total_exec_time DESC
      LIMIT 10;
    `).catch(() => [] as never);

    const env = process.env.NODE_ENV === "production" ? "prod" : "dev";
    return {
      [env]: {
        slowQueries: rows.map((r) => ({
          query: r.query.length > 250 ? r.query.slice(0, 250) + "..." : r.query,
          calls: Number(r.calls),
          meanExecMs: r.mean_exec_time_ms,
          totalExecMs: r.total_exec_time_ms,
        })),
      },
    };
  } catch {
    return {};
  }
}

/**
 * Heuristicas simples para gerar recomendacoes. Thresholds foram escolhidos
 * como pontos de atencao razoaveis para inicio; ajuste conforme o baseline
 * real da aplicacao.
 */
function deriveRecommendations(input: {
  envs: Record<string, EnvStats>;
  containers: ContainerStat[];
  host: PerfReport["host"];
}): PerfRecommendation[] {
  const recs: PerfRecommendation[] = [];

  for (const c of input.containers) {
    if (c.cpuPct > 80) {
      recs.push({
        id: `container-cpu-high:${c.name}`,
        target: c.name,
        metric: "container_cpu_pct",
        observed: c.cpuPct,
        threshold: 80,
        severity: c.cpuPct > 95 ? "critical" : "warning",
        action: "aumentar limite de CPU / escalar horizontalmente / investigar hot path via trace",
        rationale: `Container ${c.name} operando com CPU media > 80% na janela; pico ${c.cpuPctPeak.toFixed(1)}%.`,
      });
    }
    if (c.memBytes > 1_600_000_000) {
      recs.push({
        id: `container-mem-high:${c.name}`,
        target: c.name,
        metric: "container_mem_bytes",
        observed: c.memBytes,
        threshold: 1_600_000_000,
        severity: "warning",
        action: "aumentar limite de memoria ou investigar leak (heap snapshot)",
        rationale: `Container ${c.name} usando > 1.6GB (pico ${(c.memBytesPeak / 1e9).toFixed(2)}GB).`,
      });
    }
  }

  for (const d of input.host.diskFreePctByMount) {
    if (d.freePct < 15) {
      recs.push({
        id: `disk-low:${d.mount}`,
        target: `host:${d.mount}`,
        metric: "disk_free_pct",
        observed: d.freePct,
        threshold: 15,
        severity: d.freePct < 5 ? "critical" : "warning",
        action: "liberar espaco (docker prune, rotacionar logs, expandir volume)",
        rationale: `Mount ${d.mount} com apenas ${d.freePct.toFixed(1)}% livre.`,
      });
    }
  }

  for (const [env, stats] of Object.entries(input.envs)) {
    if (stats.api.p95Latency > 1) {
      recs.push({
        id: `api-p95-high:${env}`,
        target: `api:${env}`,
        metric: "http_p95_seconds",
        observed: stats.api.p95Latency,
        threshold: 1,
        severity: stats.api.p95Latency > 3 ? "critical" : "warning",
        action: "investigar rotas top5xx / cache / N+1 / adicionar replicas",
        rationale: `p95 em ${env} = ${stats.api.p95Latency.toFixed(2)}s.`,
      });
    }
    if (stats.api.errorRate > 0.05) {
      recs.push({
        id: `api-errors-high:${env}`,
        target: `api:${env}`,
        metric: "http_5xx_ratio",
        observed: stats.api.errorRate,
        threshold: 0.05,
        severity: "critical",
        action: "checar logs, corrigir rotas com maior taxa de erro, investigar dependencias externas",
        rationale: `Erro 5xx em ${env} = ${(stats.api.errorRate * 100).toFixed(1)}%.`,
      });
    }
    if (stats.db.cacheHitRatio > 0 && stats.db.cacheHitRatio < 0.9) {
      recs.push({
        id: `db-cache-low:${env}`,
        target: `db:${env}`,
        metric: "pg_cache_hit_ratio",
        observed: stats.db.cacheHitRatio,
        threshold: 0.9,
        severity: "warning",
        action: "aumentar shared_buffers / adicionar indices para consultas seq scan",
        rationale: `Cache hit ratio em ${env} = ${(stats.db.cacheHitRatio * 100).toFixed(1)}% (< 90%).`,
      });
    }
    for (const q of stats.queues.byQueue) {
      if (q.waiting > 1000) {
        recs.push({
          id: `queue-backlog:${env}:${q.name}`,
          target: `queue:${env}:${q.name}`,
          metric: "bullmq_waiting",
          observed: q.waiting,
          threshold: 1000,
          severity: "warning",
          action: "aumentar concurrency do worker / adicionar replicas do worker",
          rationale: `Fila ${q.name} em ${env} com ${q.waiting} jobs aguardando.`,
        });
      }
      if (q.failed > 50) {
        recs.push({
          id: `queue-failed:${env}:${q.name}`,
          target: `queue:${env}:${q.name}`,
          metric: "bullmq_failed",
          observed: q.failed,
          threshold: 50,
          severity: "warning",
          action: "inspecionar jobs failed (motivo) e ajustar retry/backoff ou corrigir bug",
          rationale: `Fila ${q.name} em ${env} com ${q.failed} jobs failed.`,
        });
      }
    }
    for (const sq of stats.db.slowQueries.slice(0, 3)) {
      if (sq.meanExecMs > 500) {
        recs.push({
          id: `db-slow-query:${env}:${hash(sq.query)}`,
          target: `db:${env}`,
          metric: "pg_mean_exec_ms",
          observed: sq.meanExecMs,
          threshold: 500,
          severity: "warning",
          action: "EXPLAIN ANALYZE + criar indice ou reescrever query",
          rationale: `Query media ${sq.meanExecMs.toFixed(0)}ms em ${sq.calls} chamadas: ${sq.query.slice(0, 120)}`,
        });
      }
    }
  }

  return recs;
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/**
 * Renderiza o report em Markdown legivel — util para snapshots em disco
 * e para colar diretamente em prompts de IA.
 */
export function renderReportMarkdown(r: PerfReport): string {
  const lines: string[] = [];
  lines.push(`# Perf report (v${r.schemaVersion})`);
  lines.push(``);
  lines.push(`- Gerado em: ${r.generatedAt}`);
  lines.push(`- Janela: ${r.window.from} -> ${r.window.to} (step ${r.window.stepSec}s)`);
  lines.push(`- Prometheus: ${r.prometheusConfigured ? "conectado" : "nao configurado"}`);
  lines.push(``);
  lines.push(`## Recomendacoes (${r.recommendations.length})`);
  if (r.recommendations.length === 0) lines.push(`Nenhuma recomendacao acima dos thresholds.`);
  for (const rec of r.recommendations) {
    lines.push(`- **[${rec.severity}] ${rec.id}** — ${rec.action}`);
    lines.push(`  - metric=${rec.metric} observed=${rec.observed} threshold=${rec.threshold}`);
    lines.push(`  - ${rec.rationale}`);
  }
  lines.push(``);
  lines.push(`## Containers (top por CPU)`);
  for (const c of r.containers.slice(0, 15)) {
    lines.push(`- ${c.name}: CPU ${c.cpuPct.toFixed(1)}% (pico ${c.cpuPctPeak.toFixed(1)}%), mem ${(c.memBytes / 1e6).toFixed(0)}MB (pico ${(c.memBytesPeak / 1e6).toFixed(0)}MB)`);
  }
  lines.push(``);
  lines.push(`## Host`);
  lines.push(`- load1/5/15: ${r.host.load1.toFixed(2)} / ${r.host.load5.toFixed(2)} / ${r.host.load15.toFixed(2)}`);
  lines.push(`- IO: ${r.host.ioReadsPerSec.toFixed(0)} r/s, ${r.host.ioWritesPerSec.toFixed(0)} w/s`);
  for (const d of r.host.diskFreePctByMount) lines.push(`- disk ${d.mount}: ${d.freePct.toFixed(1)}% livre`);
  lines.push(``);
  for (const [env, s] of Object.entries(r.envs)) {
    lines.push(`## Env: ${env}`);
    lines.push(`- API: ${s.api.rps.toFixed(2)} rps, p95 ${s.api.p95Latency.toFixed(2)}s, erros ${(s.api.errorRate * 100).toFixed(2)}%`);
    lines.push(`- DB: ${s.db.connectionsActive} conexoes, cache-hit ${(s.db.cacheHitRatio * 100).toFixed(1)}%, size ${(s.db.sizeBytes / 1e9).toFixed(2)}GB`);
    lines.push(`- Meta: ${s.meta.callsPerMin.toFixed(0)} req/min (erros ${(s.meta.errorRate * 100).toFixed(1)}%)`);
    lines.push(`- AI: ${s.ai.tokensPerMin.toFixed(0)} tokens/min`);
    for (const q of s.queues.byQueue) lines.push(`- queue ${q.name}: waiting=${q.waiting} active=${q.active} failed=${q.failed}`);
    if (s.db.slowQueries.length > 0) {
      lines.push(`- slow queries:`);
      for (const sq of s.db.slowQueries.slice(0, 5)) lines.push(`  - ${sq.meanExecMs.toFixed(0)}ms (${sq.calls}x): ${sq.query.slice(0, 120)}`);
    }
    lines.push(``);
  }
  return lines.join("\n");
}
