import { NextResponse } from "next/server";

import { withApiAuthContext } from "@/lib/api-auth";
import type { AppUserRole } from "@/lib/auth-types";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { getOrgIdOrThrow } from "@/lib/request-context";
import { notifyTagAdded } from "@/services/automation-triggers";
import { createDealEvent, getDealById } from "@/services/deals";

type Ctx = { params: Promise<{ id: string }> };

// Bug 27/abr/26: usavamos `auth()` direto. A rota chama `withOrgFromCtx`
// (direto ou via service), avaliado ANTES da Prisma extension popular
// o ctx. Migrado para withOrgContext.
// Fix 01/jun/26: trocado withOrgContext por withApiAuthContext para aceitar
// Bearer Token (ApiToken) além da sessão NextAuth, igual GET /api/deals.
export async function POST(request: Request, ctx: Ctx) {
  return withApiAuthContext(request, async (user) => {
    try {
      const { id } = await ctx.params;
      const existing = await getDealById(id);
      if (!existing) return NextResponse.json({ message: "Negócio não encontrado." }, { status: 404 });
      const dealId = existing.id;

      const body = (await request.json()) as Record<string, unknown>;
      const tagId = typeof body.tagId === "string" ? body.tagId.trim() : "";
      const tagName = typeof body.tagName === "string" ? body.tagName.trim() : "";
      const tagColor = typeof body.color === "string" ? body.color.trim() : "";

      if (!tagId && !tagName) {
        return NextResponse.json({ message: "tagId ou tagName obrigatório." }, { status: 400 });
      }

      let resolvedTagId = tagId;
      if (!resolvedTagId) {
        const orgId = getOrgIdOrThrow();
        const existingTag = await prisma.tag.findUnique({
          where: { organizationId_name: { organizationId: orgId, name: tagName } },
        });
        if (existingTag) {
          resolvedTagId = existingTag.id;
        } else {
          const role = user.role as AppUserRole;
          if (role !== "ADMIN" && role !== "MANAGER") {
            return NextResponse.json({ message: "Sem permissão para criar tags. Selecione uma existente." }, { status: 403 });
          }
          const tag = await prisma.tag.create({
            data: withOrgFromCtx({ name: tagName, color: tagColor || undefined }),
          });
          resolvedTagId = tag.id;
        }
      }

      const existed = await prisma.tagOnDeal.findUnique({
        where: { dealId_tagId: { dealId, tagId: resolvedTagId } },
      });
      await prisma.tagOnDeal.upsert({
        where: { dealId_tagId: { dealId, tagId: resolvedTagId } },
        update: {},
        create: { dealId, tagId: resolvedTagId },
      });

      const uid = user.id;
      const resolvedTag = await prisma.tag.findUnique({ where: { id: resolvedTagId }, select: { name: true, color: true } });
      if (!existed) {
        createDealEvent(dealId, uid, "TAG_ADDED", { tagName: resolvedTag?.name ?? tagName, tagColor: resolvedTag?.color ?? tagColor }).catch(() => {});
        void notifyTagAdded({
          dealId,
          contactId: existing.contactId,
          tagId: resolvedTagId,
          tagName: resolvedTag?.name ?? tagName,
        });
      }

      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
    }
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return withApiAuthContext(request, async (user) => {
    try {
      const { id } = await ctx.params;
      const existing = await getDealById(id);
      if (!existing) return NextResponse.json({ message: "Negócio não encontrado." }, { status: 404 });
      const dealId = existing.id;

      const body = (await request.json()) as Record<string, unknown>;
      const tagId = typeof body.tagId === "string" ? body.tagId : "";
      if (!tagId) return NextResponse.json({ message: "tagId obrigatório." }, { status: 400 });

      const tagInfo = await prisma.tag.findUnique({ where: { id: tagId }, select: { name: true, color: true } });

      await prisma.tagOnDeal.delete({
        where: { dealId_tagId: { dealId, tagId } },
      }).catch(() => {});

      const uid = user.id;
      createDealEvent(dealId, uid, "TAG_REMOVED", { tagName: tagInfo?.name ?? tagId, tagColor: tagInfo?.color ?? "" }).catch(() => {});

      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
    }
  });
}
