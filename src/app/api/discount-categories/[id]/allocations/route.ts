/**
 * /api/discount-categories/[id]/allocations
 *
 * GET  — lista as alocações de volume (DiscountQuota) desta categoria por
 *        unidade.
 * PUT  — recebe um array `[{ orgUnitId, qtyTotal, active? }]` e faz upsert
 *        atômico das alocações: cria/atualiza volumes, e DESATIVA (soft)
 *        alocações que não vieram no payload. NUNCA deleta cotas com
 *        histórico (`qtyConsumed > 0`), apenas desativa.
 *
 * `qtyTotal = null` = ilimitada. `orgUnitId = null` = alocação global
 * (independente de unidade — usado se a organização não tem filiais).
 */
import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

type Ctx = { params: Promise<{ id: string }> };

type AllocationInput = {
  orgUnitId: string | null;
  qtyTotal: number | null;
  active?: boolean;
};

function parseAllocations(raw: unknown): AllocationInput[] | null {
  if (!Array.isArray(raw)) return null;
  const out: AllocationInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const it = item as Record<string, unknown>;
    const orgUnitId =
      typeof it.orgUnitId === "string" && it.orgUnitId.trim()
        ? it.orgUnitId.trim()
        : null;
    let qtyTotal: number | null;
    if (it.qtyTotal === null || it.qtyTotal === undefined || it.qtyTotal === "") {
      qtyTotal = null;
    } else {
      const n = Number(it.qtyTotal);
      if (!Number.isFinite(n) || n < 0) return null;
      qtyTotal = Math.floor(n);
    }
    out.push({
      orgUnitId,
      qtyTotal,
      active: it.active === undefined ? true : it.active === true,
    });
  }
  return out;
}

export async function GET(request: Request, ctx: Ctx) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  return runWithApiUserContext(auth.user, async () => {
    const denied = await requirePermissionForUser(auth.user, "quota:view");
    if (denied) return denied;

    const { id } = await ctx.params;
    const category = await prisma.discountCategory.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!category) {
      return NextResponse.json(
        { message: "Categoria não encontrada." },
        { status: 404 },
      );
    }

    const rows = await prisma.discountQuota.findMany({
      where: { categoryId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        orgUnitId: true,
        orgUnit: { select: { id: true, name: true } },
        qtyTotal: true,
        qtyConsumed: true,
        active: true,
      },
    });

    return NextResponse.json({
      allocations: rows.map((r) => ({
        ...r,
        balance: r.qtyTotal === null ? null : r.qtyTotal - r.qtyConsumed,
      })),
    });
  });
}

export async function PUT(request: Request, ctx: Ctx) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  return runWithApiUserContext(auth.user, async () => {
    const denied = await requirePermissionForUser(auth.user, "quota:manage");
    if (denied) return denied;

    const { id } = await ctx.params;
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const allocations = parseAllocations(body.allocations);
    if (!allocations) {
      return NextResponse.json(
        { message: "Payload `allocations` inválido." },
        { status: 400 },
      );
    }

    const category = await prisma.discountCategory.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        discountType: true,
        discountValue: true,
        productId: true,
      },
    });
    if (!category) {
      return NextResponse.json(
        { message: "Categoria não encontrada." },
        { status: 404 },
      );
    }

    // Valida unicidade por orgUnitId no payload (evita 2 alocações mesma unidade).
    const seen = new Set<string>();
    for (const a of allocations) {
      const key = a.orgUnitId ?? "__global__";
      if (seen.has(key)) {
        return NextResponse.json(
          {
            message: `Alocação duplicada para a mesma unidade (${a.orgUnitId ?? "global"}).`,
          },
          { status: 400 },
        );
      }
      seen.add(key);
    }

    // Confere existência das unidades informadas (escopadas à org).
    const orgUnitIds = allocations
      .map((a) => a.orgUnitId)
      .filter((x): x is string => !!x);
    if (orgUnitIds.length > 0) {
      const units = await prisma.orgUnit.findMany({
        where: { id: { in: orgUnitIds } },
        select: { id: true },
      });
      if (units.length !== new Set(orgUnitIds).size) {
        return NextResponse.json(
          { message: "Uma ou mais unidades não foram encontradas." },
          { status: 400 },
        );
      }
    }

    const existing = await prisma.discountQuota.findMany({
      where: { categoryId: id },
      select: {
        id: true,
        orgUnitId: true,
        qtyConsumed: true,
        active: true,
      },
    });

    const existingByUnit = new Map<string, (typeof existing)[number]>();
    for (const q of existing) {
      existingByUnit.set(q.orgUnitId ?? "__global__", q);
    }

    const kept = new Set<string>();

    await prisma.$transaction(async (tx) => {
      for (const a of allocations) {
        const key = a.orgUnitId ?? "__global__";
        const found = existingByUnit.get(key);
        const desiredActive = a.active !== false;

        if (found) {
          // Não deixa qtyTotal cair abaixo do já consumido.
          const nextQtyTotal =
            a.qtyTotal !== null && a.qtyTotal < found.qtyConsumed
              ? found.qtyConsumed
              : a.qtyTotal;
          await tx.discountQuota.update({
            where: { id: found.id },
            data: {
              qtyTotal: nextQtyTotal,
              active: desiredActive,
            },
          });
          kept.add(found.id);
        } else {
          const shadowName = `${category.name}${a.orgUnitId ? "" : " (global)"}`;
          await tx.discountQuota.create({
            data: withOrgFromCtx({
              id: randomUUID(),
              name: shadowName,
              categoryId: category.id,
              // Colunas locais: espelho dos valores da categoria (fallback
              // se a categoria for desativada; resolver dá precedência à
              // categoria enquanto ela estiver ativa).
              discountType: category.discountType,
              discountValue: category.discountValue,
              productId: category.productId,
              orgUnitId: a.orgUnitId,
              qtyTotal: a.qtyTotal,
              qtyConsumed: 0,
              active: desiredActive,
            }),
          });
        }
      }

      // Desativa alocações que não vieram no payload (soft).
      const toDeactivate = existing.filter(
        (q) => !kept.has(q.id) && q.active,
      );
      if (toDeactivate.length > 0) {
        await tx.discountQuota.updateMany({
          where: { id: { in: toDeactivate.map((q) => q.id) } },
          data: { active: false },
        });
      }
    });

    return NextResponse.json({ ok: true });
  });
}
