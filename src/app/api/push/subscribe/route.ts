import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

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
// Bug 27/abr/26: usavamos `auth()` direto. A rota chama `withOrgFromCtx`
// (direto ou via service), avaliado ANTES da Prisma extension popular
// o ctx. Migrado para withOrgContext.
export async function POST(request: Request) {
  return withOrgContext(async (session) => {
    let body: {
      transport?: string;
      token?: string;
      platform?: string;
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const { fcmEndpointFromToken } = await import("@/lib/fcm");
    const isFcm =
      body.transport?.trim().toLowerCase() === "fcm" &&
      Boolean(body.token?.trim());

    const endpoint = isFcm
      ? fcmEndpointFromToken(body.token!)
      : body.endpoint?.trim();
    const p256dh = isFcm ? "fcm" : body.keys?.p256dh?.trim();
    const authKey = isFcm ? "fcm" : body.keys?.auth?.trim();
    const transport = isFcm ? "FCM" : "WEB";
    const platform = isFcm
      ? (body.platform?.trim() || "android")
      : (body.platform?.trim() || null);

    if (!endpoint || !p256dh || !authKey) {
      return NextResponse.json(
        { error: "missing_fields", required: ["endpoint", "keys.p256dh", "keys.auth"] },
        { status: 400 },
      );
    }

    const userAgent = request.headers.get("user-agent") ?? null;

    const sub = await prisma.webPushSubscription.upsert({
      where: { endpoint },
      create: withOrgFromCtx({
        userId: session.user.id,
        endpoint,
        p256dh,
        auth: authKey,
        transport,
        platform,
        userAgent,
      }),
      update: {
        userId: session.user.id,
        p256dh,
        auth: authKey,
        transport,
        platform,
        userAgent,
        failedAt: null,
      },
      select: { id: true },
    });

    return NextResponse.json({ ok: true, id: sub.id });
  });
}
