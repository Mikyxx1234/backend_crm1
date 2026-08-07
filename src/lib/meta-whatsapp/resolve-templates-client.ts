import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import { metaClientFromConfig, type MetaWhatsAppClient } from "./client";

type SessionForMetaTemplates = {
  organizationId: string | null;
  isSuperAdmin: boolean;
  /** Quando informado, usa esse canal META_CLOUD_API (não o último updatedAt). */
  channelId?: string | null;
};

export type ResolveMetaTemplatesClientResult =
  | { ok: true; client: MetaWhatsAppClient; channelId: string }
  | { ok: false; response: NextResponse };

/**
 * Cliente Graph/Meta para listar/criar/excluir templates WABA.
 * Sempre usa credenciais do canal `META_CLOUD_API` da organização da sessão
 * (via Prisma extension + RequestContext), nunca o singleton de env global —
 * evita leak multi-tenant (ex.: DNA Work vendo templates da WABA da EduIT).
 *
 * Com `channelId`: resolve esse canal (org-scoped). Sem: último CONNECTED
 * (fallback: qualquer META_CLOUD_API) — compatível com n8n/callers antigos.
 */
export async function resolveMetaTemplatesClient(
  session: SessionForMetaTemplates,
): Promise<ResolveMetaTemplatesClientResult> {
  if (!session.isSuperAdmin && !session.organizationId) {
    return {
      ok: false,
      response: NextResponse.json({ message: "Sessão sem organização." }, { status: 401 }),
    };
  }

  if (session.isSuperAdmin && !session.organizationId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          message:
            "Super-admin sem organização no contexto: entre no CRM no contexto de uma organização para gerir templates WABA.",
        },
        { status: 400 },
      ),
    };
  }

  const baseWhere = {
    type: "WHATSAPP" as const,
    provider: "META_CLOUD_API" as const,
  };

  const requestedId = typeof session.channelId === "string" ? session.channelId.trim() : "";

  let channel: { id: string; config: unknown } | null = null;

  if (requestedId) {
    channel = await prisma.channel.findFirst({
      where: { ...baseWhere, id: requestedId },
      select: { id: true, config: true },
    });
    if (!channel) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            message:
              "Canal WhatsApp Cloud API não encontrado nesta organização. Verifique o channelId.",
          },
          { status: 404 },
        ),
      };
    }
  } else {
    const connected = await prisma.channel.findFirst({
      where: { ...baseWhere, status: "CONNECTED" },
      select: { id: true, config: true },
      orderBy: { updatedAt: "desc" },
    });
    channel =
      connected ??
      (await prisma.channel.findFirst({
        where: baseWhere,
        select: { id: true, config: true },
        orderBy: { updatedAt: "desc" },
      }));
  }

  if (!channel) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          message:
            "Nenhum canal WhatsApp Cloud API nesta organização. Crie e conecte um canal em Configurações → Canais.",
        },
        { status: 503 },
      ),
    };
  }

  const client = metaClientFromConfig(channel.config as Record<string, unknown> | null | undefined, {
    allowEnvFallback: false,
  });

  if (!client.templatesConfigured) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          message:
            "Nenhum canal WhatsApp Cloud API nesta organização com accessToken, phoneNumberId e businessAccountId (WABA). Configure em Configurações → Canais.",
        },
        { status: 503 },
      ),
    };
  }

  return { ok: true, client, channelId: channel.id };
}
