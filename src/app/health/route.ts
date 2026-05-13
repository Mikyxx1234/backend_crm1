import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Healthcheck mínimo para load balancer / Easypanel (sem dependências). */
export async function GET() {
  return NextResponse.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
