/**
 * Conexão manual do WhatsApp Cloud API — igual ao Datacrazy.
 *
 * Recebe TOKEN direto (o cliente já tem um token permanente/de sistema no
 * Meta Business), sem OAuth. Provisiona o canal assinando `subscribed_apps`
 * no WABA do cliente para o App Meta global do CRM, então o webhook é
 * automaticamente entregue no nosso Callback URL — sem o cliente tocar no
 * painel `developers.facebook.com`.
 *
 * A verificação de assinatura do webhook recebido usa o `CRM_META_APP_SECRET`
 * global (env `META_APP_SECRET`), portanto NÃO gravamos App Secret por canal.
 */
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  MetaProvisionError,
  provisionMetaCloudChannel,
} from "@/services/channels-meta-provision";

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
    const accessToken =
      typeof b.accessToken === "string" ? b.accessToken.trim() : "";
    const phoneNumberId =
      typeof b.phoneNumberId === "string" ? b.phoneNumberId.trim() : "";
    const wabaId = typeof b.wabaId === "string" ? b.wabaId.trim() : "";
    const channelId =
      typeof b.channelId === "string" && b.channelId.trim()
        ? b.channelId.trim()
        : undefined;

    if (!accessToken || !phoneNumberId || !wabaId) {
      return NextResponse.json(
        {
          message:
            "Preencha Nome da conexão, Token de acesso, ID do número de telefone e WABA ID.",
        },
        { status: 400 },
      );
    }

    if (!channelId && !name) {
      return NextResponse.json(
        { message: "Nome da conexão é obrigatório." },
        { status: 400 },
      );
    }

    const result = await provisionMetaCloudChannel({
      accessToken,
      phoneNumberId,
      wabaId,
      name: name || undefined,
      channelId,
      embeddedSignup: false,
    });

    return NextResponse.json(
      { channel: result.channel },
      { status: result.created ? 201 : 200 },
    );
  } catch (e: unknown) {
    if (e instanceof MetaProvisionError) {
      return NextResponse.json({ message: e.message }, { status: e.status });
    }
    console.error("Manual Cloud connect error:", e);
    const msg =
      e instanceof Error ? e.message : "Erro ao conectar canal manual.";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}
