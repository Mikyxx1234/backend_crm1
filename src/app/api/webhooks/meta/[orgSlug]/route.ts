/**
 * Rota de webhook Meta WhatsApp scoped por organizacao.
 *
 * URL: /api/webhooks/meta/{slug}  (ex: /api/webhooks/meta/eduit)
 *
 * Como funciona:
 *   1. Resolve Organization pelo slug (404 se nao existir).
 *   2. Chama o handler com scope = { organizationId, organizationSlug }.
 *   3. Handler:
 *      - GET: valida verifyToken contra Channel.config.verifyToken DESSA org
 *      - POST: valida appSecret contra Channel.config.appSecret DESSA org
 *      - Toda a logica de processamento roda dentro de
 *        withSystemContext(orgId), entao a Prisma extension automaticamente
 *        filtra todas as queries por organizationId.
 *
 * Setup pro cliente:
 *   - No painel Meta (developers.facebook.com -> seu app -> WhatsApp -> Configuracao):
 *       Callback URL: https://<dominio-prod>/api/webhooks/meta/{slug-da-org}
 *       Verify Token: o valor copiado de /settings/channels da org
 *   - Em /settings/channels da org: cadastrar verifyToken + appSecret no canal
 *
 * Veja: docs/onboarding-meta-cliente.md
 */
import { NextResponse } from "next/server";

import { prismaBase } from "@/lib/prisma-base";
import {
  handleMetaWebhookGet,
  handleMetaWebhookPost,
} from "@/lib/meta-webhook/handler";

type Ctx = { params: Promise<{ orgSlug: string }> };

async function resolveScope(orgSlug: string) {
  const org = await prismaBase.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, slug: true, status: true },
  });
  if (!org) return { error: "organization not found", status: 404 } as const;
  if (org.status !== "ACTIVE") {
    return { error: "organization not active", status: 403 } as const;
  }
  return {
    scope: { organizationId: org.id, organizationSlug: org.slug },
  } as const;
}

export async function GET(request: Request, ctx: Ctx) {
  const { orgSlug } = await ctx.params;
  const r = await resolveScope(orgSlug);
  if ("error" in r) {
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  return handleMetaWebhookGet(request, r.scope);
}

export async function POST(request: Request, ctx: Ctx) {
  const { orgSlug } = await ctx.params;
  const r = await resolveScope(orgSlug);
  if ("error" in r) {
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  return handleMetaWebhookPost(request, r.scope);
}
