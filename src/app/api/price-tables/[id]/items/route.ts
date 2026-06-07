/**
 * GET  /api/price-tables/[id]/items   — itens da tabela (produto + preço + validade)
 * POST /api/price-tables/[id]/items   — adiciona produto à tabela
 *
 * Permissões:
 *   - GET  exige `product:view`
 *   - POST exige `product:manage`
 *
 * Regras:
 *   - Unique por (priceTableId, productId) — não permite duplicar produto.
 *   - `price` obrigatório, >= 0. `discountMax` opcional, 0..100.
 *   - `validFrom`/`validUntil` opcionais (ISO 8601). Se ambos presentes,
 *     valida que validUntil >= validFrom.
 */

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ id: string }> };

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

export async function GET(_req: Request, { params }: RouteParams) {
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

    const table = await prisma.priceTable.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!table) {
      return NextResponse.json({ message: "Tabela não encontrada." }, { status: 404 });
    }

    const items = await prisma.priceTableItem.findMany({
      where: { priceTableId: id },
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true, isActive: true } },
      },
      orderBy: [{ product: { name: "asc" } }],
    });

    return NextResponse.json({ items });
  });
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
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

    const productId = typeof body.productId === "string" ? body.productId.trim() : "";
    if (!productId) {
      return NextResponse.json({ message: "productId é obrigatório." }, { status: 400 });
    }
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ message: "price deve ser número >= 0." }, { status: 400 });
    }

    let discountMax: number | null = null;
    if (body.discountMax !== undefined && body.discountMax !== null) {
      const dm = Number(body.discountMax);
      if (!Number.isFinite(dm) || dm < 0 || dm > 100) {
        return NextResponse.json(
          { message: "discountMax deve estar entre 0 e 100." },
          { status: 400 },
        );
      }
      discountMax = dm;
    }

    const validFrom = parseDate(body.validFrom);
    const validUntil = parseDate(body.validUntil);
    if (validFrom && validUntil && validUntil < validFrom) {
      return NextResponse.json(
        { message: "validUntil precisa ser >= validFrom." },
        { status: 400 },
      );
    }

    const table = await prisma.priceTable.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!table) {
      return NextResponse.json({ message: "Tabela não encontrada." }, { status: 404 });
    }
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) {
      return NextResponse.json({ message: "Produto não encontrado." }, { status: 404 });
    }

    try {
      const item = await prisma.priceTableItem.create({
        data: {
          priceTableId: id,
          productId,
          price,
          discountMax,
          validFrom,
          validUntil,
        },
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true } },
        },
      });
      return NextResponse.json({ item }, { status: 201 });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        return NextResponse.json(
          {
            message: "Este produto já está nesta tabela de preço.",
            code: "DUPLICATE_PRODUCT_IN_TABLE",
          },
          { status: 409 },
        );
      }
      throw e;
    }
  });
}
