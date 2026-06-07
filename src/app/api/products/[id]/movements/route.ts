/**
 * GET  /api/products/[id]/movements  — histórico de movimentações do produto
 * POST /api/products/[id]/movements  — ajuste manual (ADJUSTMENT)
 *
 * Permissões:
 *   - GET:  product:view
 *   - POST: product:manage
 *
 * POST body:
 *   {
 *     delta: number,         // pode ser positivo (INCREASE) ou negativo (DECREASE)
 *     reason?: string,
 *     contractItemId?: string // se setado, ajusta saldo do contrato; senão Product.stock
 *   }
 *
 * Sempre via StockMovement — nunca editar Product.stock direto.
 */

import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/request-context";
import { recordStockMovement } from "@/services/stock";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return withOrgContext(async (session) => {
    const ctx = await loadAuthzContext({
      userId: session.user.id,
      organizationId: session.user.organizationId,
      isSuperAdmin: session.user.isSuperAdmin,
    });
    if (!can(ctx, "product:view")) {
      return NextResponse.json(
        { message: "Acesso negado.", required: "product:view" },
        { status: 403 },
      );
    }

    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    const type = url.searchParams.get("type");
    const contractId = url.searchParams.get("contractId");

    const where: Record<string, unknown> = { productId: id };
    if (type) where.type = type;
    if (contractId) where.contractId = contractId;

    const [movements, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        include: {
          contract: { select: { id: true, code: true } },
          deal: { select: { id: true, title: true } },
          user: { select: { id: true, name: true } },
        },
      }),
      prisma.stockMovement.count({ where }),
    ]);

    return NextResponse.json({ movements, total, limit, offset });
  });
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id: productId } = await params;
  return withOrgContext(async (session) => {
    const ctx = await loadAuthzContext({
      userId: session.user.id,
      organizationId: session.user.organizationId,
      isSuperAdmin: session.user.isSuperAdmin,
    });
    if (!can(ctx, "product:manage")) {
      return NextResponse.json(
        { message: "Acesso negado.", required: "product:manage" },
        { status: 403 },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const delta = Number(body.delta);
    if (!Number.isFinite(delta) || delta === 0) {
      return NextResponse.json(
        { message: "delta deve ser número diferente de zero." },
        { status: 400 },
      );
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() || null : null;
    const contractItemId =
      typeof body.contractItemId === "string" ? body.contractItemId.trim() || null : null;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, organizationId: true, trackStock: true },
    });
    if (!product) {
      return NextResponse.json({ message: "Produto não encontrado." }, { status: 404 });
    }
    if (!product.trackStock) {
      return NextResponse.json(
        {
          message: "Produto não controla saldo (trackStock=false). Habilite antes de ajustar.",
          code: "PRODUCT_TRACK_STOCK_DISABLED",
        },
        { status: 409 },
      );
    }

    const reqCtx = getRequestContext();
    const userId = reqCtx?.userId ?? null;

    const result = await prisma.$transaction((tx) =>
      recordStockMovement(tx, {
        organizationId: product.organizationId,
        productId,
        contractItemId,
        userId,
        type: "ADJUSTMENT",
        quantity: Math.abs(delta),
        reason: reason ?? "manual_adjustment",
        metadata: { direction: delta > 0 ? "INCREASE" : "DECREASE", delta },
      }),
    );

    return NextResponse.json({ movement: result }, { status: 201 });
  });
}
