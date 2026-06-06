/**
 * Notas vinculadas a um Deal.
 *
 * Existe porque o frontend (deal-workspace, deal-detail, contact-panel)
 * faz fallback para esta rota quando o deal não tem `contactId`. Antes
 * estava 404 e a nota silenciosamente não era criada. Agora roteamos
 * a mesma lógica de `/api/contacts/[id]/notes` com `dealId` direto.
 */

import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { createDealEvent } from "@/services/deals";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return withOrgContext(async () => {
    try {
      const { id: dealId } = await ctx.params;
      // Notas exibidas no deal: tudo que tem `dealId = id` OU `contactId`
      // pertencente ao contato dono do deal. O Prisma OR retorna o
      // conjunto unido — frontend já desempata por createdAt.
      const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        select: { contactId: true },
      });
      if (!deal) {
        return NextResponse.json({ message: "Deal não encontrado." }, { status: 404 });
      }

      const notes = await prisma.note.findMany({
        where: {
          OR: [
            { dealId },
            ...(deal.contactId ? [{ contactId: deal.contactId }] : []),
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { user: { select: { id: true, name: true } } },
      });
      return NextResponse.json(notes);
    } catch (e) {
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro." },
        { status: 500 },
      );
    }
  });
}

export async function POST(request: Request, ctx: Ctx) {
  return withOrgContext(async (session) => {
    try {
      const { id: dealId } = await ctx.params;
      const body = (await request.json()) as Record<string, unknown>;
      const content = typeof body.content === "string" ? body.content.trim() : "";
      if (!content) {
        return NextResponse.json({ message: "Conteúdo obrigatório." }, { status: 400 });
      }

      const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        select: { id: true, contactId: true },
      });
      if (!deal) {
        return NextResponse.json({ message: "Deal não encontrado." }, { status: 404 });
      }

      const note = await prisma.note.create({
        data: withOrgFromCtx({
          content,
          dealId: deal.id,
          contactId: deal.contactId ?? undefined,
          userId: session.user.id as string,
        }),
        include: { user: { select: { id: true, name: true } } },
      });

      const uid = session.user.id as string;
      // createDealEvent ja faz fan-out para logEvent (DEAL) +
      // dealEvent (legado). Mantemos para preservar a timeline de
      // deal pre-activity-log.
      createDealEvent(deal.id, uid, "NOTE_ADDED", {
        noteId: note.id,
        preview: content.slice(0, 200),
        source: "deal_workspace",
      }).catch(() => {});

      return NextResponse.json(note, { status: 201 });
    } catch (e) {
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro." },
        { status: 500 },
      );
    }
  });
}
