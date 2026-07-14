import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getDealById } from "@/services/deals";

type Ctx = { params: Promise<{ id: string }> };

const CUID_RE = /^c[a-z0-9]{20,}$/;

function normalizeStageRef(raw: unknown): { id?: string; name?: string } | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") return { id: raw };
  return raw as { id?: string; name?: string };
}

function needsName(ref: { id?: string; name?: string } | undefined): boolean {
  return Boolean(ref?.id && (!ref.name || CUID_RE.test(ref.name)));
}

export async function GET(_req: Request, ctx: Ctx) {
  return withOrgContext(async () => {
  try {
    const { id } = await ctx.params;
    const existing = await getDealById(id);
    if (!existing)
      return NextResponse.json(
        { message: "Negócio não encontrado." },
        { status: 404 },
      );

    // Le do novo log unificado (activity_events). Para nao quebrar o
    // contrato consumido pelo timeline-panel.tsx (que espera
    // { id, type, meta, createdAt, user }), mapeamos os campos de
    // volta. Durante o cutover, se nao houver activity_events para
    // este deal (backfill nao rodou ainda), cai no deal_events legado.
    type LegacyShape = {
      id: string;
      type: string;
      meta: Record<string, unknown>;
      createdAt: Date;
      user: { id: string; name: string; avatarUrl: string | null } | null;
    };

    // Eventos escopados ao contato do negócio (tags/campos do contato) são
    // logados com `contactId` e SEM `dealId` — por isso não apareciam na
    // timeline do negócio. Incluímos explicitamente esses tipos pro contato
    // deste deal, sem puxar tudo (mensagens já vêm via dealId).
    const contactId = existing.contactId ?? null;
    const CONTACT_SCOPED_TYPES = [
      "CONTACT_TAG_ADDED",
      "CONTACT_TAG_REMOVED",
      "CONTACT_FIELD_CHANGED",
    ];

    let events: LegacyShape[] = (
      await prisma.activityEvent.findMany({
        where: contactId
          ? {
              OR: [
                { dealId: existing.id },
                { contactId, type: { in: CONTACT_SCOPED_TYPES } },
              ],
            }
          : { dealId: existing.id },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 200,
        include: {
          actorUser: { select: { id: true, name: true, avatarUrl: true } },
        },
      })
    ).map((a) => ({
      id: a.id,
      type: a.type,
      meta: (a.meta ?? {}) as Record<string, unknown>,
      createdAt: a.occurredAt,
      user: a.actorUser
        ? {
            id: a.actorUser.id,
            name: a.actorUser.name ?? a.actorLabel ?? "—",
            avatarUrl: a.actorUser.avatarUrl ?? null,
          }
        : a.actorLabel
          ? { id: a.actorRef ?? a.id, name: a.actorLabel, avatarUrl: null }
          : null,
    }));

    if (events.length === 0) {
      events = (
        await prisma.dealEvent.findMany({
          where: { dealId: existing.id },
          orderBy: { createdAt: "desc" },
          take: 200,
          include: {
            user: { select: { id: true, name: true, avatarUrl: true } },
          },
        })
      ).map((e) => ({
        id: e.id,
        type: e.type,
        meta: (e.meta ?? {}) as Record<string, unknown>,
        createdAt: e.createdAt,
        user: e.user
          ? {
              id: e.user.id,
              name: e.user.name ?? "—",
              avatarUrl: e.user.avatarUrl ?? null,
            }
          : null,
      }));
    }

    const stageIds = new Set<string>();
    const fieldIds = new Set<string>();

    for (const ev of events) {
      const m = ev.meta as Record<string, unknown>;
      if (ev.type === "STAGE_CHANGED") {
        const from = normalizeStageRef(m.from);
        const to = normalizeStageRef(m.to);
        if (needsName(from)) stageIds.add(from!.id!);
        if (needsName(to)) stageIds.add(to!.id!);
      }
      if (ev.type === "CUSTOM_FIELD_UPDATED") {
        const label = m.fieldLabel as string | undefined;
        const fid = m.fieldId as string | undefined;
        if (label && CUID_RE.test(label)) fieldIds.add(label);
        if (fid && CUID_RE.test(fid)) fieldIds.add(fid);
      }
    }

    const stageMap = new Map<string, string>();
    const fieldMap = new Map<string, string>();

    if (stageIds.size > 0) {
      const stages = await prisma.stage.findMany({
        where: { id: { in: [...stageIds] } },
        select: { id: true, name: true },
      });
      for (const s of stages) stageMap.set(s.id, s.name);
    }

    if (fieldIds.size > 0) {
      const fields = await prisma.customField.findMany({
        where: { id: { in: [...fieldIds] } },
        select: { id: true, label: true },
      });
      for (const f of fields) fieldMap.set(f.id, f.label);
    }

    const enriched = events.map((ev) => {
      const m = ev.meta as Record<string, unknown>;

      if (ev.type === "STAGE_CHANGED") {
        const from = normalizeStageRef(m.from);
        const to = normalizeStageRef(m.to);

        const patchedFrom = { ...from };
        const patchedTo = { ...to };
        let changed = false;

        if (needsName(from)) {
          const resolved = stageMap.get(from!.id!);
          if (resolved) {
            patchedFrom.name = resolved;
            changed = true;
          } else if (!from!.name) {
            patchedFrom.name = "Etapa removida";
            changed = true;
          }
        }
        if (needsName(to)) {
          const resolved = stageMap.get(to!.id!);
          if (resolved) {
            patchedTo.name = resolved;
            changed = true;
          } else if (!to!.name) {
            patchedTo.name = "Etapa removida";
            changed = true;
          }
        }
        if (changed) {
          return { ...ev, meta: { ...m, from: patchedFrom, to: patchedTo } };
        }
      }

      if (ev.type === "CUSTOM_FIELD_UPDATED") {
        const label = m.fieldLabel as string | undefined;
        const fid = m.fieldId as string | undefined;
        if (label && CUID_RE.test(label)) {
          const resolved = fieldMap.get(label);
          return { ...ev, meta: { ...m, fieldLabel: resolved ?? "Campo removido" } };
        }
        if (!label && fid && CUID_RE.test(fid)) {
          const resolved = fieldMap.get(fid);
          return { ...ev, meta: { ...m, fieldLabel: resolved ?? "Campo removido" } };
        }
      }

      return ev;
    });

    return NextResponse.json(enriched);
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Erro." },
      { status: 500 },
    );
  }
  });
}
