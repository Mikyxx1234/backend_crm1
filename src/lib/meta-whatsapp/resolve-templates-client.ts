import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import { metaClientFromConfig, type MetaWhatsAppClient } from "./client";

type SessionForMetaTemplates = {
  organizationId: string | null;
  isSuperAdmin: boolean;
};

export type ResolveMetaTemplatesClientResult =
  | { ok: true; client: MetaWhatsAppClient }
  | { ok: false; response: NextResponse };

/**
 * Cliente Graph/Meta para listar/criar/excluir templates WABA.
 * Sempre usa credenciais do canal `META_CLOUD_API` da organização da sessão
 * (via Prisma extension + RequestContext), nunca o singleton de env global —
 * evita leak multi-tenant (ex.: DNA Work vendo templates da WABA da EduIT).
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

  let channel = await prisma.channel.findFirst({
    where: { ...baseWhere, status: "CONNECTED" },
    select: { config: true },
    orderBy: { updatedAt: "desc" },
  });

  if (!channel) {
    channel = await prisma.channel.findFirst({
      where: baseWhere,
      select: { config: true },
      orderBy: { updatedAt: "desc" },
    });
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

  return { ok: true, client };
}
