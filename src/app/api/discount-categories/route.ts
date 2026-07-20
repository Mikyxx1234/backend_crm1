/**
 * /api/discount-categories — CRUD admin de Categorias de Desconto.
 *
 * Categoria = fonte da verdade de % + regras (exclusionGroup, maxStacks,
 * calcMode, vigencia). Cada categoria tem N `DiscountQuota` (alocações de
 * volume por unidade). Zero regressão: cotas legadas (`categoryId=null`)
 * continuam usando as próprias colunas.
 *
 * Permissões: reusa `quota:view`/`quota:manage`.
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
    const activeParam = url.searchParams.get("active");
    const active =
      activeParam === "true"
        ? true
        : activeParam === "false"
          ? false
          : undefined;
    const includeQuotas = url.searchParams.get("includeQuotas") === "true";

    const where: Record<string, unknown> = {};
    if (search) where.name = { contains: search, mode: "insensitive" };
    if (active !== undefined) where.active = active;

    const rows = await prisma.discountCategory.findMany({
      where,
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        discountType: true,
        discountValue: true,
        productId: true,
        product: { select: { id: true, name: true } },
        exclusionGroup: true,
        maxStacks: true,
        calcMode: true,
        validFrom: true,
        validTo: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        quotas: includeQuotas
          ? {
              select: {
                id: true,
                orgUnitId: true,
                orgUnit: { select: { id: true, name: true } },
                qtyTotal: true,
                qtyConsumed: true,
                active: true,
              },
              orderBy: { createdAt: "asc" },
            }
          : false,
      },
    });

    return NextResponse.json({
      categories: rows.map((r) => ({
        ...r,
        discountValue: Number(r.discountValue),
        quotas: includeQuotas
          ? (r as unknown as { quotas: Array<{ qtyTotal: number | null; qtyConsumed: number }> }).quotas.map(
              (q) => ({
                ...q,
                balance:
                  q.qtyTotal === null ? null : q.qtyTotal - q.qtyConsumed,
              }),
            )
          : undefined,
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

    const discountType = body.discountType === "FIXED" ? "FIXED" : "PERCENT";
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

    const productId =
      typeof body.productId === "string" && body.productId.trim()
        ? body.productId.trim()
        : null;
    if (productId) {
      const p = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (!p) {
        return NextResponse.json(
          { message: "Produto não encontrado." },
          { status: 400 },
        );
      }
    }

    const calcMode = body.calcMode === "SUM_SIMPLE" ? "SUM_SIMPLE" : "CASCADE";
    const maxStacks = Math.max(1, Math.floor(Number(body.maxStacks ?? 1)) || 1);

    const created = await prisma.discountCategory.create({
      data: withOrgFromCtx({
        name,
        discountType,
        discountValue,
        productId,
        exclusionGroup:
          typeof body.exclusionGroup === "string" && body.exclusionGroup.trim()
            ? body.exclusionGroup.trim()
            : null,
        maxStacks,
        calcMode,
        validFrom: toDateOrNull(body.validFrom) ?? new Date(),
        validTo: toDateOrNull(body.validTo),
        active: body.active !== false,
      }),
      select: { id: true },
    });

    return NextResponse.json({ id: created.id }, { status: 201 });
  });
}
