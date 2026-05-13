import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/push/unsubscribe
 *
 * Body: { endpoint: string }
 *
 * Deleta a subscription do dispositivo que esta desligando o push.
 * Soh apaga se o `endpoint` pertencer ao usuario logado — ataques
 * de "unsubscribe alheio" sao rejeitados silenciosamente
 * (devolvemos `ok: true` mesmo se nada foi apagado pra evitar
 * enumeracao).
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { endpoint?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const endpoint = body.endpoint?.trim();
  if (!endpoint) {
    return NextResponse.json({ error: "missing_endpoint" }, { status: 400 });
  }

  await prisma.webPushSubscription.deleteMany({
    where: { endpoint, userId: session.user.id },
  });

  return NextResponse.json({ ok: true });
}
