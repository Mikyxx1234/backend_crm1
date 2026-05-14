/**
 * GET /api/metrics — endpoint Prometheus exposition (PR 2.2).
 *
 * Protegido por bearer token em `METRICS_TOKEN` (env). Sem token configurado,
 * o endpoint responde 503 — força operação consciente em prod (defesa em
 * profundidade vs. exposição acidental de cardinalidade interna).
 *
 * Scrape recomendado a cada 15s pelo Prometheus do compose self-host. Em
 * SaaS futuro (Grafana Cloud), usar Grafana Agent + remote_write apontando
 * pra cá com o mesmo token.
 */

import { NextResponse } from "next/server";

import { renderMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function GET(request: Request) {
  const expected = process.env.METRICS_TOKEN?.trim();
  if (!expected) {
    return new NextResponse("metrics endpoint disabled (set METRICS_TOKEN)", {
      status: 503,
    });
  }

  const auth = request.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (!provided || !timingSafeEqual(provided, expected)) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const { body, contentType } = await renderMetrics();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}
