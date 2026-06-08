import { NextResponse } from "next/server";

import type { Prisma } from "@prisma/client";

import { requireManager } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/activity-feed
 *
 * Feed global de atividade (org-scoped, cronologico descendente) com
 * paginacao por cursor composto (occurredAt + id — desempate estavel
 * em eventos do mesmo instante).
 *
 * Query params:
 *   - cursor          string (opcional, formato `${occurredAtMs}_${id}`)
 *   - limit           int (default 50, max 200)
 *   - entityType      EventEntityType (csv aceito: "DEAL,CONTACT")
 *   - actorType       ActorType (csv aceito)
 *   - actorUserId     userId
 *   - type            string ou csv (filtra tipos de evento)
 *   - dateFrom        ISO date
 *   - dateTo          ISO date
 *   - entityId        id (para timeline de uma entidade especifica)
 *   - dealId          id (atalho — filtra dealId direto)
 *   - contactId       id
 *   - conversationId  id
 *   - q               busca textual (entityLabel ILIKE / actorLabel ILIKE)
 *
 * Resposta:
 *   { items: ActivityFeedRow[], nextCursor: string | null }
 */

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

export async function GET(req: Request) {
  try {
    // Logs são restritos a gestão (ADMIN/MANAGER). requireManager também
    // configura o RequestContext, então o prisma scoped abaixo funciona.
    const r = await requireManager();
    if (!r.ok) return r.response;

    const url = new URL(req.url);
    const sp = url.searchParams;

    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number(sp.get("limit") ?? DEFAULT_LIMIT) | 0 || DEFAULT_LIMIT),
    );
    const cursor = parseCursor(sp.get("cursor"));

    const entityTypes = parseCsv(sp.get("entityType"));
    const actorTypes = parseCsv(sp.get("actorType"));
    const types = parseCsv(sp.get("type"));
    const actorUserId = sp.get("actorUserId");
    const entityId = sp.get("entityId");
    const dealId = sp.get("dealId");
    const contactId = sp.get("contactId");
    const conversationId = sp.get("conversationId");
    const dateFrom = sp.get("dateFrom");
    const dateTo = sp.get("dateTo");
    const q = sp.get("q")?.trim();

    const where: Prisma.ActivityEventWhereInput = {};

    if (entityTypes) {
      // Cast: enums Prisma sao string em runtime; o cliente nao expoe
      // o tipo literal `EventEntityType` aqui de forma generica sem
      // ts2322. Validacao real fica na constraint do enum no banco.
      (where as Record<string, unknown>).entityType = { in: entityTypes };
    }
    if (actorTypes) {
      (where as Record<string, unknown>).actorType = { in: actorTypes };
    }
    if (types) where.type = { in: types };
    if (actorUserId) where.actorUserId = actorUserId;
    if (entityId) where.entityId = entityId;
    if (dealId) where.dealId = dealId;
    if (contactId) where.contactId = contactId;
    if (conversationId) where.conversationId = conversationId;

    if (dateFrom || dateTo) {
      where.occurredAt = {};
      if (dateFrom) (where.occurredAt as { gte?: Date }).gte = new Date(dateFrom);
      if (dateTo) (where.occurredAt as { lte?: Date }).lte = new Date(dateTo);
    }

    if (q) {
      where.OR = [
        { entityLabel: { contains: q, mode: "insensitive" } },
        { actorLabel: { contains: q, mode: "insensitive" } },
        { actorSublabel: { contains: q, mode: "insensitive" } },
        { type: { contains: q, mode: "insensitive" } },
      ];
    }

    // Cursor composto: occurredAt desc, id desc (desempate estavel).
    // Em SQL puro seria:
    //   WHERE (occurredAt, id) < (:cursorAt, :cursorId)
    // Como Prisma nao suporta tupla, usamos OR canonico:
    if (cursor) {
      const cursorAnd: Prisma.ActivityEventWhereInput = {
        OR: [
          { occurredAt: { lt: cursor.occurredAt } },
          {
            occurredAt: cursor.occurredAt,
            id: { lt: cursor.id },
          },
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
}
