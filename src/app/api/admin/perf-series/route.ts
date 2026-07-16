/**
 * GET /api/admin/perf-series — series temporais para graficos do painel.
 *
 * Super-admin only. Faz queries `query_range` no Prometheus e retorna
 * series prontas para plotar. Cada serie ja vem com `label` legivel
 * (nome do container / env) para o front nao precisar decidir.
 *
 * Query params:
 *   windowMinutes  janela historica (default 60, min 5, max 720)
 *   stepSec        resolucao em segundos (default auto, min 15)
 *   metric         qual grupo puxar (default "all"):
 *                    - container_cpu
 *                    - container_mem
 *                    - api_rps
 *                    - api_p95
 *                    - api_errors
 *                    - queue_waiting
 *                    - all (todos, mais pesado)
 *
 * Contrato:
 *   { window, stepSec, series: { [metric]: Array<{ label, points: [{t,v}] }> } }
 */

import { NextResponse } from "next/server";

import { requireSuperAdmin } from "@/lib/auth-helpers";
import { promRange, isPromConfigured } from "@/lib/perf/prometheus-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MetricGroup =
  | "container_cpu"
  | "container_mem"
  | "api_rps"
  | "api_p95"
  | "api_errors"
  | "queue_waiting";

const QUERIES: Record<MetricGroup, { query: string; labelFrom: (m: Record<string, string>) => string }> = {
  container_cpu: {
    query: 'sum by (name) (rate(container_cpu_usage_seconds_total{name=~".+"}[5m])) * 100',
    labelFrom: (m) => m.name ?? "?",
  },
  container_mem: {
    query: 'container_memory_working_set_bytes{name=~".+"}',
    labelFrom: (m) => m.name ?? "?",
  },
  api_rps: {
    query: 'sum by (env) (rate(crm_http_requests_total[5m]))',
    labelFrom: (m) => m.env ?? "?",
  },
  api_p95: {
    query: 'histogram_quantile(0.95, sum by (env, le) (rate(crm_http_request_duration_seconds_bucket[5m])))',
    labelFrom: (m) => m.env ?? "?",
  },
  api_errors: {
    query: 'sum by (env) (rate(crm_http_requests_total{status=~"5.."}[5m]))',
    labelFrom: (m) => m.env ?? "?",
  },
  queue_waiting: {
    query: 'sum by (queue) (crm_bullmq_queue_depth{state="waiting"})',
    labelFrom: (m) => m.queue ?? "?",
  },
};

export async function GET(request: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  if (!isPromConfigured()) {
    return NextResponse.json(
      { window: null, stepSec: 0, series: {}, error: "PROMETHEUS_URL nao configurado." },
      { status: 200 },
    );
  }

  const url = new URL(request.url);
  const windowMinutes = clamp(Number(url.searchParams.get("windowMinutes") ?? "60"), 5, 720, 60);
  const stepDefault = Math.max(15, Math.round((windowMinutes * 60) / 60)); // ~60 pontos
  const stepSec = clamp(Number(url.searchParams.get("stepSec") ?? String(stepDefault)), 15, 3600, stepDefault);
  const metricParam = (url.searchParams.get("metric") ?? "all") as MetricGroup | "all";

  const groups: MetricGroup[] = metricParam === "all"
    ? (Object.keys(QUERIES) as MetricGroup[])
    : [metricParam];

  const to = new Date();
  const from = new Date(to.getTime() - windowMinutes * 60_000);

  const series: Record<string, Array<{ label: string; points: Array<{ t: number; v: number }> }>> = {};

  await Promise.all(
    groups.map(async (g) => {
      const q = QUERIES[g];
      const rs = await promRange(q.query, { from, to, stepSec });
      series[g] = rs.map((r) => ({
        label: q.labelFrom(r.metric),
        points: r.values,
      }));
    }),
  );

  return NextResponse.json(
    {
      window: { from: from.toISOString(), to: to.toISOString() },
      stepSec,
      series,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

function clamp(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
