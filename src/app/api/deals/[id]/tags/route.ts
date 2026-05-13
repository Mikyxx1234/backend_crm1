import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import type { AppUserRole } from "@/lib/auth-types";
import { prisma } from "@/lib/prisma";
import { createDealEvent, getDealById } from "@/services/deals";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });

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
      const existing = await prisma.tag.findUnique({ where: { name: tagName } });
      if (existing) {
        resolvedTagId = existing.id;
      } else {
        const role = (session.user as { role?: AppUserRole }).role;
        if (role !== "ADMIN" && role !== "MANAGER") {
          return NextResponse.json({ message: "Sem permissão para criar tags. Selecione uma existente." }, { status: 403 });
        }
        const tag = await prisma.tag.create({ data: { name: tagName, color: tagColor || undefined } });
        resolvedTagId = tag.id;
      }
    }

    await prisma.tagOnDeal.upsert({
      where: { dealId_tagId: { dealId, tagId: resolvedTagId } },
      update: {},
      create: { dealId, tagId: resolvedTagId },
    });

    const uid = (session.user as { id: string }).id;
    const resolvedTag = await prisma.tag.findUnique({ where: { id: resolvedTagId }, select: { name: true, color: true } });
    createDealEvent(dealId, uid, "TAG_ADDED", { tagName: resolvedTag?.name ?? tagName, tagColor: resolvedTag?.color ?? tagColor }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });

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

    const uid = (session.user as { id: string }).id;
    createDealEvent(dealId, uid, "TAG_REMOVED", { tagName: tagInfo?.name ?? tagId, tagColor: tagInfo?.color ?? "" }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ message: e instanceof Error ? e.message : "Erro." }, { status: 500 });
  }
}
