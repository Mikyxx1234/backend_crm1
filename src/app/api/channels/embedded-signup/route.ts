import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { CRM_META_APP_ID, CRM_META_APP_SECRET } from "@/lib/meta-constants";
import {
  createChannel,
  getChannelById,
  updateChannel,
} from "@/services/channels";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

function randomPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const b = body as Record<string, unknown>;
    const code = typeof b.code === "string" ? b.code.trim() : "";
    const phoneNumberId =
      typeof b.phoneNumberId === "string" ? b.phoneNumberId.trim() : "";
    const wabaId = typeof b.wabaId === "string" ? b.wabaId.trim() : "";
    const channelName =
      typeof b.name === "string" && b.name.trim() ? b.name.trim() : undefined;
    const channelId =
      typeof b.channelId === "string" && b.channelId.trim()
        ? b.channelId.trim()
        : undefined;
    const reqAppSecret =
      typeof b.appSecret === "string" && b.appSecret.trim()
        ? b.appSecret.trim()
        : undefined;

    if (!code) {
      return NextResponse.json(
        { message: "Código de autorização (code) é obrigatório." },
        { status: 400 },
      );
    }
    if (!phoneNumberId || !wabaId) {
      return NextResponse.json(
        { message: "phoneNumberId e wabaId são obrigatórios." },
        { status: 400 },
      );
    }

    if (channelId) {
      const existing = await getChannelById(channelId);
      if (!existing) {
        return NextResponse.json(
          { message: "Canal não encontrado." },
          { status: 404 },
        );
      }
    }

    const appId = CRM_META_APP_ID;
    const appSecret = reqAppSecret || CRM_META_APP_SECRET;

    // Step 1: Exchange code for business token (30s TTL on code)
    const tokenUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("code", code);

    const tokenRes = await fetch(tokenUrl.toString());
    const tokenData = (await tokenRes.json()) as Record<string, unknown>;

    if (!tokenRes.ok || tokenData.error) {
      const errMsg =
        typeof tokenData.error === "object" && tokenData.error !== null
          ? ((tokenData.error as Record<string, unknown>).message as string)
          : "Falha ao trocar código por token.";
      console.error("Embedded Signup token exchange error:", tokenData);
      return NextResponse.json({ message: errMsg }, { status: 400 });
    }

    const accessToken =
      typeof tokenData.access_token === "string"
        ? tokenData.access_token
        : "";
    if (!accessToken) {
      return NextResponse.json(
        { message: "Token de acesso não retornado pela Meta." },
        { status: 502 },
      );
    }

    // Step 2: Subscribe to webhooks on the customer's WABA
    const subRes = await fetch(
      `${GRAPH_BASE}/${wabaId}/subscribed_apps`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!subRes.ok) {
      const subErr = (await subRes.json()) as Record<string, unknown>;
      console.error("Embedded Signup webhook subscribe error:", subErr);
    }

    // Step 3: Register the phone number
    const pin = randomPin();
    const regRes = await fetch(`${GRAPH_BASE}/${phoneNumberId}/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ messaging_product: "whatsapp", pin }),
    });
    if (!regRes.ok) {
      const regErr = (await regRes.json()) as Record<string, unknown>;
      console.error("Embedded Signup phone register error:", regErr);
      // Non-fatal: phone may already be registered
    }

    // Step 4: Get display phone number
    let displayPhone = phoneNumberId;
    let verifiedName = "";
    try {
      const phoneRes = await fetch(
        `${GRAPH_BASE}/${phoneNumberId}?fields=display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (phoneRes.ok) {
        const phoneData = (await phoneRes.json()) as Record<string, unknown>;
        if (typeof phoneData.display_phone_number === "string") {
          displayPhone = phoneData.display_phone_number;
        }
        if (typeof phoneData.verified_name === "string") {
          verifiedName = phoneData.verified_name;
        }
      }
    } catch {
      // Non-fatal
    }

    const config = {
      accessToken,
      phoneNumberId,
      businessAccountId: wabaId,
      embeddedSignup: true,
      verifiedName: verifiedName || undefined,
      twoStepPin: pin,
    };

    // Step 5: Create or update channel
    let channel;
    if (channelId) {
      channel = await updateChannel(channelId, {
        config,
        phoneNumber: displayPhone,
        status: "CONNECTED",
        lastConnectedAt: new Date(),
        qrCode: null,
      });
    } else {
      channel = await createChannel({
        name: channelName || verifiedName || `WhatsApp ${displayPhone}`,
        type: "WHATSAPP",
        provider: "META_CLOUD_API",
        config,
        phoneNumber: displayPhone,
      });
      channel = await updateChannel(channel.id, {
        status: "CONNECTED",
        lastConnectedAt: new Date(),
      });
    }

    return NextResponse.json({ channel }, { status: channelId ? 200 : 201 });
  } catch (e: unknown) {
    console.error("Embedded Signup error:", e);
    const msg =
      e instanceof Error ? e.message : "Erro no Embedded Signup.";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}
