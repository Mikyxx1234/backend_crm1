import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { withOrgContext } from "@/lib/auth-helpers";
import { requireConversationAccess } from "@/lib/conversation-access";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/conversations/[id]/timeline
 *
 * Timeline de eventos DESTA conversa (org-scoped via Prisma extension +
 * `requireConversationAccess`). Diferente de `/api/activity-feed`, que e
 * um feed global restrito a MANAGER, este endpoint fica acessivel a
 * qualquer agente com acesso a conversa — igual `/messages`.
 *
 * Query params:
 *   - cursor  string (opcional, formato `${occurredAtMs}_${id}`)
 *   - limit   int (default 50, max 200)
 *   - type    string ou csv (filtra tipos de evento)
 *
 * Resposta:
 *   { items: ActivityEvent[], nextCursor: string | null }
 */

type RouteContext = { params: Promise<{ id: string }> };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseCursor(raw: string | null): { occurredAt: Date; id: string } | null {
  if (!raw) return null;
  const [tsStr, id] = raw.split("_");
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || !id) return null;
  return { occurredAt: new Date(ts), id };
}

function parseCsv(raw: string | null): string[] | null {
  if (!raw) return null;
  const arr = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length > 0 ? arr : null;
}

export async function GET(req: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    try {
      const { id: conversationId } = await context.params;

      const denied = await requireConversationAccess(session, conversationId);
      if (denied) return denied;

      const url = new URL(req.url);
      const sp = url.searchParams;

      const limit = Math.min(
        MAX_LIMIT,
        Math.max(1, Number(sp.get("limit") ?? DEFAULT_LIMIT) | 0 || DEFAULT_LIMIT),
      );
      const cursor = parseCursor(sp.get("cursor"));
      const types = parseCsv(sp.get("type"));

      // A timeline da conversa mostra eventos ligados diretamente a ela
      // (conversationId) E as mudancas de etapa/status do(s) negocio(s) do
      // contato. Estas ultimas sao logadas como eventos de DEAL (com dealId
      // e SEM conversationId) por createDealEvent — por isso a "troca de
      // fase do funil" nao aparecia aqui. Resolvemos os deals do contato e
      // incluimos esses tipos explicitamente (paridade com a timeline do
      // negocio, que ja puxa eventos contact-scoped).
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { contactId: true },
      });
      let dealIds: string[] = [];
      if (conv?.contactId) {
        const deals = await prisma.deal.findMany({
          where: { contactId: conv.contactId },
          select: { id: true },
        });
        dealIds = deals.map((d) => d.id);
      }

      const DEAL_SCOPED_TYPES = ["STAGE_CHANGED", "STATUS_CHANGED"];

      const scopeOr: Prisma.ActivityEventWhereInput[] = [{ conversationId }];
      if (dealIds.length > 0) {
        scopeOr.push({ dealId: { in: dealIds }, type: { in: DEAL_SCOPED_TYPES } });
      }

      const where: Prisma.ActivityEventWhereInput = { OR: scopeOr };
      if (types) where.type = { in: types };

      // Cursor composto identico ao /api/activity-feed — desempate estavel
      // em eventos do mesmo instante (occurredAt desc, id desc).
      if (cursor) {
        const cursorAnd: Prisma.ActivityEventWhereInput = {
          OR: [
            { occurredAt: { lt: cursor.occurredAt } },
            { occurredAt: cursor.occurredAt, id: { lt: cursor.id } },
          ],
        };
        where.AND = where.AND
          ? Array.isArray(where.AND)
            ? [...where.AND, cursorAnd]
            : [where.AND, cursorAnd]
          : cursorAnd;
      }

      const rows = await prisma.activityEvent.findMany({
        where,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        include: {
          actorUser: { select: { id: true, name: true, avatarUrl: true } },
        },
      });

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const last = items[items.length - 1];
      const nextCursor =
        hasMore && last ? `${last.occurredAt.getTime()}_${last.id}` : null;

      return NextResponse.json({ items, nextCursor });
    } catch (e) {
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro." },
        { status: 500 },
      );
    }
  });
}
