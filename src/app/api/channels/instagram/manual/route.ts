/**
 * POST /api/channels/instagram/manual
 *
 * Conexao manual do Instagram Direct (App Meta da org), espelhando
 * `/api/channels/manual-cloud` do WhatsApp.
 */
import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import {
  IgManualProvisionError,
  provisionInstagramManualChannel,
} from "@/services/channels-instagram-manual";

export async function POST(request: Request) {
  return withOrgContext(async () => {
    try {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
      }

      const b = body as Record<string, unknown>;
      const str = (k: string) => {
        const v = b[k];
        return typeof v === "string" && v.trim() ? v.trim() : undefined;
      };

      const accessToken = str("accessToken") ?? "";
      const instagramUserId = str("instagramUserId") ?? "";
      const name = str("name") ?? "";
      const channelId = str("channelId");
      const verifyToken = str("verifyToken");
      const webhookId = str("webhookId");
      const appSecret = str("appSecret");

      if (!accessToken) {
        return NextResponse.json(
          { message: "Preencha Token de acesso e Instagram User ID." },
          { status: 400 },
        );
      }
      if (!channelId && !name) {
        return NextResponse.json(
          { message: "Nome da conexão é obrigatório." },
          { status: 400 },
        );
      }
      if (webhookId && !appSecret) {
        return NextResponse.json(
          {
            message:
              "Cole o App Secret do seu App Meta no botão Webhook antes de criar o canal.",
          },
          { status: 400 },
        );
      }

      const result = await provisionInstagramManualChannel({
        accessToken,
        instagramUserId: instagramUserId || undefined,
        name: name || undefined,
        channelId,
        verifyToken,
        webhookId,
        appSecret,
      });

      return NextResponse.json({
        channelId: result.channel.id,
        created: result.created,
        username: result.username,
        webhookSubscribed: result.webhookSubscribed,
        status: result.channel.status,
      });
    } catch (e: unknown) {
      if (e instanceof IgManualProvisionError) {
        return NextResponse.json({ message: e.message }, { status: e.status });
      }
      const msg = e instanceof Error ? e.message : "Erro ao conectar Instagram.";
      return NextResponse.json({ message: msg }, { status: 500 });
    }
  });
}
