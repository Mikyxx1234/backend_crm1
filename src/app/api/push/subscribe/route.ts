import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/push/subscribe
 *
 * Body: PushSubscription.toJSON() do Web Push API
 * {
 *   endpoint: string;
 *   keys: { p256dh: string; auth: string };
 * }
 *
 * Faz UPSERT pelo `endpoint` (unique). Se um operador re-instalar
 * o PWA no mesmo dispositivo, o browser pode gerar um endpoint
 * novo OU reutilizar — em ambos os casos nao queremos duplicatas.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const endpoint = body.endpoint?.trim();
  const p256dh = body.keys?.p256dh?.trim();
  const authKey = body.keys?.auth?.trim();

  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json(
      { error: "missing_fields", required: ["endpoint", "keys.p256dh", "keys.auth"] },
      { status: 400 },
    );
  }

  const userAgent = request.headers.get("user-agent") ?? null;

  const sub = await prisma.webPushSubscription.upsert({
    where: { endpoint },
    create: {
      userId: session.user.id,
      endpoint,
      p256dh,
      auth: authKey,
      userAgent,
    },
    update: {
      // Se o mesmo endpoint volta pra outro usuario (reset de
      // browser, login com outra conta no mesmo aparelho), trocamos
      // o owner — o endpoint sempre pertence ao usuario logado AGORA.
      userId: session.user.id,
      p256dh,
      auth: authKey,
      userAgent,
      failedAt: null,
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, id: sub.id });
}
