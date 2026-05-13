import { NextResponse } from "next/server";
import IORedis from "ioredis";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Endpoint público de saúde, consumido por monitores externos (UptimeRobot,
 * BetterStack, k8s liveness, etc). Liberado no middleware — NÃO exigir auth.
 *
 * Estratégia:
 *  - Testa Postgres com `SELECT 1` e Redis com `PING`, ambos com timeout
 *    individual curto (HEALTH_TIMEOUT_MS) pra não pendurar o monitor.
 *  - Retorna 200 se as duas dependências OK, 503 se alguma falhar.
 *  - Sempre `Cache-Control: no-store` pra evitar resposta carimbada por
 *    Traefik/CDN.
 *  - Reaproveita uma conexão IORedis singleton (via globalThis) pra
 *    não vazar sockets em ambiente serverless/dev com hot reload.
 */

const HEALTH_TIMEOUT_MS = 2000;

const startedAt = Date.now();

const globalForHealth = globalThis as unknown as {
  healthRedis?: IORedis;
};

function getHealthRedis(): IORedis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!globalForHealth.healthRedis) {
    globalForHealth.healthRedis = new IORedis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: HEALTH_TIMEOUT_MS,
      commandTimeout: HEALTH_TIMEOUT_MS,
      enableOfflineQueue: false,
      reconnectOnError: () => false,
    });
    globalForHealth.healthRedis.on("error", () => {
      // silencia: o ping abaixo já reporta o erro pro caller.
    });
  }
  return globalForHealth.healthRedis;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout após ${ms}ms`)), ms),
    ),
  ]);
}

type CheckResult = { ok: true; latencyMs: number } | { ok: false; error: string };

async function checkPostgres(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, HEALTH_TIMEOUT_MS, "postgres");
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function checkRedis(): Promise<CheckResult> {
  const t0 = Date.now();
  const redis = getHealthRedis();
  if (!redis) return { ok: false, error: "REDIS_URL não configurado" };
  try {
    if (redis.status === "wait" || redis.status === "end") {
      await withTimeout(redis.connect(), HEALTH_TIMEOUT_MS, "redis-connect");
    }
    const pong = await withTimeout(redis.ping(), HEALTH_TIMEOUT_MS, "redis-ping");
    if (pong !== "PONG") return { ok: false, error: `resposta inesperada: ${pong}` };
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET() {
  const [db, redis] = await Promise.all([checkPostgres(), checkRedis()]);
  const ok = db.ok && redis.ok;
  const body = {
    status: ok ? "ok" : "degraded",
    db,
    redis,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(body, {
    status: ok ? 200 : 503,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function HEAD() {
  const [db, redis] = await Promise.all([checkPostgres(), checkRedis()]);
  return new NextResponse(null, {
    status: db.ok && redis.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
