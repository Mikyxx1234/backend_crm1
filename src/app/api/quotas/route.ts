/**
 * /api/quotas — CRUD admin mínimo de Cotas de Desconto (PRD Cotas — Fase 1).
 *
 * Escopo desta rota: LIST e CREATE. GET/PATCH/DELETE por id ficam em
 * `[id]/route.ts`. Toda escrita em cota passa pelo `QuotaService` — mas
 * a CRIAÇÃO da própria cota (registro estático de cupom) é I/O simples,
 * sem transição de saldo, então cabe aqui.
 *
 * Permissões:
 *   - GET  -> `quota:view`
 *   - POST -> `quota:manage`
 */
import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(request: Request) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "quota:view");
    if (denied) return denied;

    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.trim() ?? "";
    const productId = url.searchParams.get("productId")?.trim() || undefined;
    const orgUnitId = url.searchParams.get("orgUnitId")?.trim() || undefined;
    const activeParam = url.searchParams.get("active");
    const active =
      activeParam === "true"
        ? true
        : activeParam === "false"
          ? false
          : undefined;

    const where: Record<string, unknown> = {};
    if (search) where.name = { contains: search, mode: "insensitive" };
    if (productId) where.productId = productId;
    if (orgUnitId) where.orgUnitId = orgUnitId;
    if (active !== undefined) where.active = active;

    const rows = await prisma.discountQuota.findMany({
      where,
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        discountType: true,
        discountValue: true,
        productId: true,
        product: { select: { id: true, name: true } },
        orgUnitId: true,
        orgUnit: { select: { id: true, name: true } },
        qtyTotal: true,
        qtyConsumed: true,
        validFrom: true,
        validTo: true,
        exclusionGroup: true,
        maxStacks: true,
        calcMode: true,
        active: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      quotas: rows.map((r) => ({
        ...r,
        discountValue: Number(r.discountValue),
        balance: r.qtyTotal === null ? null : r.qtyTotal - r.qtyConsumed,
      })),
    });
  });
}

export async function POST(request: Request) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "quota:manage");
    if (denied) return denied;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ message: "Nome é obrigatório." }, { status: 400 });
    }

    const discountType =
      body.discountType === "FIXED" ? "FIXED" : "PERCENT";
    const discountValue = num(body.discountValue);
    if (discountValue === null || discountValue <= 0) {
      return NextResponse.json(
        { message: "Valor do desconto deve ser maior que zero." },
        { status: 400 },
      );
    }
    if (discountType === "PERCENT" && discountValue > 100) {
      return NextResponse.json(
        { message: "Percentual não pode exceder 100." },
        { status: 400 },
      );
    }

    const qtyTotalRaw = body.qtyTotal;
    const qtyTotal =
      qtyTotalRaw === null || qtyTotalRaw === undefined || qtyTotalRaw === ""
        ? null
        : Math.max(0, Math.floor(Number(qtyTotalRaw)));

    const productId =
      typeof body.productId === "string" && body.productId.trim()
        ? body.productId.trim()
        : null;
    const orgUnitId =
      typeof body.orgUnitId === "string" && body.orgUnitId.trim()
        ? body.orgUnitId.trim()
        : null;

    // Valida existência (mesma org — extension escopa).
    if (productId) {
      const p = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (!p) {
        return NextResponse.json({ message: "Produto não encontrado." }, { status: 400 });
      }
    }
    if (orgUnitId) {
      const u = await prisma.orgUnit.findUnique({
        where: { id: orgUnitId },
        select: { id: true },
      });
      if (!u) {
        return NextResponse.json({ message: "Unidade não encontrada." }, { status: 400 });
      }
    }

    const calcMode = body.calcMode === "SUM_SIMPLE" ? "SUM_SIMPLE" : "CASCADE";
    const maxStacks = Math.max(1, Math.floor(Number(body.maxStacks ?? 1)) || 1);

    const created = await prisma.discountQuota.create({
      data: withOrgFromCtx({
        name,
        discountType,
        discountValue,
        productId,
        orgUnitId,
        qtyTotal,
        qtyConsumed: 0,
        validFrom: toDateOrNull(body.validFrom) ?? new Date(),
        validTo: toDateOrNull(body.validTo),
        exclusionGroup:
          typeof body.exclusionGroup === "string" && body.exclusionGroup.trim()
            ? body.exclusionGroup.trim()
            : null,
        maxStacks,
        calcMode,
        active: body.active !== false,
      }),
      select: { id: true },
    });

    return NextResponse.json({ id: created.id }, { status: 201 });
  });
}
