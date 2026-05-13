import type { ChannelProvider, ChannelType } from "@prisma/client";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { createChannel, getChannels } from "@/services/channels";

const CHANNEL_TYPES = new Set<string>([
  "WHATSAPP",
  "INSTAGRAM",
  "FACEBOOK",
  "EMAIL",
  "WEBCHAT",
]);

const CHANNEL_PROVIDERS = new Set<string>([
  "META_CLOUD_API",
  "BAILEYS_MD",
]);

function isChannelType(v: unknown): v is ChannelType {
  return typeof v === "string" && CHANNEL_TYPES.has(v);
}

function isChannelProvider(v: unknown): v is ChannelProvider {
  return typeof v === "string" && CHANNEL_PROVIDERS.has(v);
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const channels = await getChannels();
    return NextResponse.json({ channels });
  } catch (e: unknown) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "Erro ao listar canais.";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
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
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name) {
      return NextResponse.json({ message: "Nome do canal é obrigatório." }, { status: 400 });
    }
    if (!isChannelType(b.type)) {
      return NextResponse.json({ message: "Tipo de canal inválido." }, { status: 400 });
    }
    if (!isChannelProvider(b.provider)) {
      return NextResponse.json({ message: "Provedor inválido." }, { status: 400 });
    }

    const phoneNumber =
      typeof b.phoneNumber === "string" && b.phoneNumber.trim() !== ""
        ? b.phoneNumber.trim()
        : undefined;
    const config =
      b.config !== undefined && b.config !== null && typeof b.config === "object"
        ? (b.config as object)
        : undefined;

    const channel = await createChannel({
      name,
      type: b.type,
      provider: b.provider,
      config,
      phoneNumber,
    });

    return NextResponse.json({ channel }, { status: 201 });
  } catch (e: unknown) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "Erro ao criar canal.";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}
