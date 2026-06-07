/**
 * PUT    /api/price-tables/[id]/items/[itemId]  — editar item
 * DELETE /api/price-tables/[id]/items/[itemId]  — remover item
 *
 * Permissões: ambos exigem `product:manage`.
 *
 * Regras:
 *   - Não permite trocar `productId` em PUT (recriar o item se precisar).
 *   - `price`, `discountMax`, `validFrom`, `validUntil` são atualizáveis
 *     individualmente; `null` em validFrom/validUntil limpa o campo.
 */

import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { fireTrigger } from "@/services/automation-triggers";

type RouteParams = { params: Promise<{ id: string; itemId: string }> };

function parseDateOrNull(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

export async function PUT(request: Request, { params }: RouteParams) {
  const { id, itemId } = await params;
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

    const existing = await prisma.priceTableItem.findFirst({
      where: { id: itemId, priceTableId: id },
    });
    if (!existing) {
      return NextResponse.json({ message: "Item não encontrado." }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (body.price !== undefined) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price < 0) {
        return NextResponse.json({ message: "price deve ser número >= 0." }, { status: 400 });
      }
      data.price = price;
    }
    if (body.discountMax !== undefined) {
      if (body.discountMax === null) {
        data.discountMax = null;
      } else {
        const dm = Number(body.discountMax);
        if (!Number.isFinite(dm) || dm < 0 || dm > 100) {
          return NextResponse.json(
            { message: "discountMax deve estar entre 0 e 100." },
            { status: 400 },
          );
        }
        data.discountMax = dm;
      }
    }

    const vf = parseDateOrNull(body.validFrom);
    if (vf !== undefined) data.validFrom = vf;
    const vu = parseDateOrNull(body.validUntil);
    if (vu !== undefined) data.validUntil = vu;

    const finalFrom = data.validFrom !== undefined ? data.validFrom : existing.validFrom;
    const finalUntil = data.validUntil !== undefined ? data.validUntil : existing.validUntil;
    if (finalFrom && finalUntil && finalUntil < finalFrom) {
      return NextResponse.json(
        { message: "validUntil precisa ser >= validFrom." },
        { status: 400 },
      );
    }

    const item = await prisma.priceTableItem.update({
      where: { id: itemId },
      data,
      include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
    });

    if (data.price !== undefined && Number(data.price) !== Number(existing.price)) {
      fireTrigger("price_changed", {
        data: {
          organizationId: session.user.organizationId,
          priceTableId: id,
          productId: item.productId,
          productName: item.product.name,
          previousPrice: Number(existing.price),
          newPrice: Number(item.price),
          userId: session.user.id,
        },
      }).catch(() => {});
    }

    return NextResponse.json({ item });
  });
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const { id, itemId } = await params;
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

    const existing = await prisma.priceTableItem.findFirst({
      where: { id: itemId, priceTableId: id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ message: "Item não encontrado." }, { status: 404 });
    }

    await prisma.priceTableItem.delete({ where: { id: itemId } });
    return NextResponse.json({ ok: true });
  });
}
