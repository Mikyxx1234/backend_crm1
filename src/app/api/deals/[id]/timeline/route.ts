import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
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
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });

    const { id } = await ctx.params;
    const existing = await getDealById(id);
    if (!existing)
      return NextResponse.json(
        { message: "Negócio não encontrado." },
        { status: 404 },
      );

    const events = await prisma.dealEvent.findMany({
      where: { dealId: existing.id },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

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
}
