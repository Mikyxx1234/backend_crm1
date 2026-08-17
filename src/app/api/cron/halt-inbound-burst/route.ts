/**
 * GET  /api/cron/halt-inbound-burst              dry-run
 * POST /api/cron/halt-inbound-burst?apply=1      encerra tickets do burst
 *
 * Autenticação: `Authorization: Bearer ${CRON_SECRET}` ou `?secret=`.
 *
 * No container de prod:
 *   curl -fsS "http://127.0.0.1:3000/api/cron/halt-inbound-burst?secret=$CRON_SECRET&hours=6"
 *   curl -fsS -X POST "http://127.0.0.1:3000/api/cron/halt-inbound-burst?secret=$CRON_SECRET&hours=6&apply=1"
 */

import { NextResponse } from "next/server";

import {
  DEFAULT_BURST_PHONE_NUMBER_ID,
  haltInboundBurst,
} from "@/services/ai/halt-inbound-burst";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function authorize(request: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return NextResponse.json(
      { ok: false, message: "CRON_SECRET nao configurado." },
      { status: 503 },
    );
  }
  const url = new URL(request.url);
  const headerSecret = (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const provided = headerSecret || (url.searchParams.get("secret")?.trim() ?? "");
  if (!provided || provided !== expected) {
    return NextResponse.json(
      { ok: false, message: "Cron secret invalido." },
      { status: 401 },
    );
  }
  return null;
}

function parseOpts(request: Request, applyDefault: boolean) {
  const url = new URL(request.url);
  const hours = Number.parseInt(url.searchParams.get("hours") ?? "6", 10);
  const apply =
    applyDefault ||
    url.searchParams.get("apply") === "1" ||
    url.searchParams.get("apply") === "true";
  const phoneNumberId =
    url.searchParams.get("phoneNumberId")?.trim() || DEFAULT_BURST_PHONE_NUMBER_ID;
  const organizationId = url.searchParams.get("org")?.trim() || null;
  const requireHandoffPreview = url.searchParams.get("allOpen") !== "1";
  return { apply, hours, phoneNumberId, organizationId, requireHandoffPreview };
}

export async function GET(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    const result = await haltInboundBurst(parseOpts(request, false));
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron/halt-inbound-burst]", e);
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Erro no halt." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    const result = await haltInboundBurst(parseOpts(request, true));
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron/halt-inbound-burst]", e);
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Erro no halt." },
      { status: 500 },
    );
  }
}
