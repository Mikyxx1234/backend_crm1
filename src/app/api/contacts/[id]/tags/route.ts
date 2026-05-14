import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import type { AppUserRole } from "@/lib/auth-types";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { getOrgIdOrThrow } from "@/lib/request-context";

type Ctx = { params: Promise<{ id: string }> };

// Bug 27/abr/26: usavamos `auth()` direto. A rota chama `withOrgFromCtx`
// (direto ou via service), avaliado ANTES da Prisma extension popular
// o ctx. Migrado para withOrgContext.
export async function POST(request: Request, ctx: Ctx) {
  return withOrgContext(async (session) => {
    try {
      const { id: contactId } = await ctx.params;
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
        const existing = await prisma.tag.findUnique({
          where: { organizationId_name: { organizationId: orgId, name: tagName } },
        });
        if (existing) {
          resolvedTagId = existing.id;
        } else {
          const role = (session.user as { role?: AppUserRole }).role;
          if (role !== "ADMIN" && role !== "MANAGER") {
            return NextResponse.json({ message: "Sem permissão para criar tags. Selecione uma existente." }, { status: 403 });
          }
          const tag = await prisma.tag.create({
            data: withOrgFromCtx({ name: tagName, color: tagColor || undefined }),
          });
          resolvedTagId = tag.id;
        }
      }

      await prisma.tagOnContact.upsert({
        where: { contactId_tagId: { contactId, tagId: resolvedTagId } },
        update: {},
        create: { contactId, tagId: resolvedTagId },
      });

      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
    }
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return withOrgContext(async () => {
    try {
      const { id: contactId } = await ctx.params;
      const body = (await request.json()) as Record<string, unknown>;
      const tagId = typeof body.tagId === "string" ? body.tagId : "";
      if (!tagId) return NextResponse.json({ message: "tagId obrigatório." }, { status: 400 });

      await prisma.tagOnContact.delete({
        where: { contactId_tagId: { contactId, tagId } },
      }).catch(() => {});

      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
    }
  });
}
