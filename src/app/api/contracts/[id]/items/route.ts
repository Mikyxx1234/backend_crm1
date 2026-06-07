/**
 * GET  /api/contracts/[id]/items   — itens do contrato
 * POST /api/contracts/[id]/items   — adiciona item + StockMovement ENTRY
 *
 * Permissões:
 *   - GET:  product:view
 *   - POST: product:manage
 *
 * Adicionar item NÃO mexe em Product.stock global. Apenas popula
 * ContractItem.balance via ENTRY no escopo do ContractItem.
 */

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/request-context";
import { recordStockMovement } from "@/services/stock";

type RouteParams = { params: Promise<{ id: string }> };

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

    const contract = await prisma.contract.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!contract) {
      return NextResponse.json({ message: "Contrato não encontrado." }, { status: 404 });
    }

    const items = await prisma.contractItem.findMany({
      where: { contractId: id },
      include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
      orderBy: { createdAt: "asc" },
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
    const quantity = Number(body.quantity);
    const unitPrice = Number(body.unitPrice);
    const discount = body.discount === undefined ? 0 : Number(body.discount);
    const balance = body.balance === undefined ? quantity : Number(body.balance);

    if (!productId) {
      return NextResponse.json({ message: "productId é obrigatório." }, { status: 400 });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ message: "quantity inválida." }, { status: 400 });
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return NextResponse.json({ message: "unitPrice inválido." }, { status: 400 });
    }
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      return NextResponse.json({ message: "discount inválido." }, { status: 400 });
    }
    if (!Number.isFinite(balance) || balance < 0) {
      return NextResponse.json({ message: "balance inválido." }, { status: 400 });
    }

    const contract = await prisma.contract.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!contract) {
      return NextResponse.json({ message: "Contrato não encontrado." }, { status: 404 });
    }
    if (contract.status === "CANCELLED" || contract.status === "COMPLETED") {
      return NextResponse.json(
        { message: `Contrato ${contract.status} não aceita novos itens.` },
        { status: 409 },
      );
    }

    const reqCtx = getRequestContext();
    const userId = reqCtx?.userId ?? null;
    const organizationId = session.user.organizationId;
    if (!organizationId) {
      return NextResponse.json({ message: "organização não resolvida." }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.contractItem.create({
        data: {
          contractId: id,
          productId,
          quantity: new Prisma.Decimal(quantity),
          unitPrice: new Prisma.Decimal(unitPrice),
          discount: new Prisma.Decimal(discount),
          balance: new Prisma.Decimal(0),
        },
      });
      await recordStockMovement(tx, {
        organizationId,
        productId,
        contractItemId: item.id,
        userId,
        type: "ENTRY",
        quantity: balance,
        reason: "contract_item_added",
      });
      return tx.contractItem.findUnique({
        where: { id: item.id },
        include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
      });
    });

    return NextResponse.json({ item: result }, { status: 201 });
  });
}
