/**
 * GET  /api/contracts  — lista contratos (filtros: status, companyId, dealId)
 * POST /api/contracts  — cria contrato + gera StockMovement ENTRY para cada item
 *
 * Permissões:
 *   - GET  exige `product:view`
 *   - POST exige `product:manage`
 *
 * Body POST:
 *   {
 *     code?, status?, startDate?, endDate?, notes?,
 *     dealId?, companyId?, contactId?, priceTableId?, ownerId?,
 *     items: [{ productId, quantity, unitPrice, discount?, balance? }]
 *   }
 *
 * Para cada item:
 *   - `balance` default = `quantity` (saldo contratado começa igual ao quantitativo).
 *   - Cria StockMovement ENTRY com `contractId` setado — adiciona ao pool do
 *     ContractItem (não toca Product.stock global).
 */

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { getRequestContext } from "@/lib/request-context";
import { fireTrigger } from "@/services/automation-triggers";
import { recordStockMovement } from "@/services/stock";

export async function GET(request: Request) {
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
    const status = url.searchParams.get("status");
    const companyId = url.searchParams.get("companyId");
    const dealId = url.searchParams.get("dealId");
    const contactId = url.searchParams.get("contactId");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (companyId) where.companyId = companyId;
    if (dealId) where.dealId = dealId;
    if (contactId) where.contactId = contactId;

    const contracts = await prisma.contract.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        company: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true, status: true } },
        owner: { select: { id: true, name: true } },
        priceTable: { select: { id: true, name: true } },
        _count: { select: { items: true, movements: true } },
      },
    });

    return NextResponse.json({ contracts });
  });
}

export async function POST(request: Request) {
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

    const itemsRaw = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
    if (itemsRaw.length === 0) {
      return NextResponse.json(
        { message: "Contrato precisa de ao menos 1 item." },
        { status: 400 },
      );
    }

    const items: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
      discount: number;
      balance: number;
    }> = [];
    for (const it of itemsRaw) {
      const productId = typeof it.productId === "string" ? it.productId.trim() : "";
      const quantity = Number(it.quantity);
      const unitPrice = Number(it.unitPrice);
      const discount = it.discount === undefined ? 0 : Number(it.discount);
      const balance = it.balance === undefined ? quantity : Number(it.balance);

      if (!productId) {
        return NextResponse.json({ message: "Item sem productId." }, { status: 400 });
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return NextResponse.json(
          { message: `quantity inválida para item ${productId}.` },
          { status: 400 },
        );
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return NextResponse.json(
          { message: `unitPrice inválido para item ${productId}.` },
          { status: 400 },
        );
      }
      if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
        return NextResponse.json(
          { message: `discount inválido para item ${productId}.` },
          { status: 400 },
        );
      }
      if (!Number.isFinite(balance) || balance < 0) {
        return NextResponse.json(
          { message: `balance inválido para item ${productId}.` },
          { status: 400 },
        );
      }
      items.push({ productId, quantity, unitPrice, discount, balance });
    }

    const reqCtx = getRequestContext();
    const userId = reqCtx?.userId ?? null;
    const organizationId = session.user.organizationId;
    if (!organizationId) {
      return NextResponse.json({ message: "organização não resolvida." }, { status: 400 });
    }

    const contract = await prisma.$transaction(async (tx) => {
      const created = await tx.contract.create({
        data: withOrgFromCtx({
          code: typeof body.code === "string" ? body.code.trim() || null : null,
          status: typeof body.status === "string" ? body.status : "ACTIVE",
          startDate: body.startDate ? new Date(body.startDate as string) : null,
          endDate: body.endDate ? new Date(body.endDate as string) : null,
          notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
          dealId: typeof body.dealId === "string" ? body.dealId : null,
          companyId: typeof body.companyId === "string" ? body.companyId : null,
          contactId: typeof body.contactId === "string" ? body.contactId : null,
          priceTableId: typeof body.priceTableId === "string" ? body.priceTableId : null,
          ownerId: typeof body.ownerId === "string" ? body.ownerId : null,
        }),
      });

      for (const it of items) {
        const item = await tx.contractItem.create({
          data: {
            contractId: created.id,
            productId: it.productId,
            quantity: new Prisma.Decimal(it.quantity),
            unitPrice: new Prisma.Decimal(it.unitPrice),
            discount: new Prisma.Decimal(it.discount),
            balance: new Prisma.Decimal(0),
          },
          select: { id: true },
        });
        // ENTRY popula balance do ContractItem (que começa em 0)
        await recordStockMovement(tx, {
          organizationId,
          productId: it.productId,
          contractItemId: item.id,
          dealId: null,
          userId,
          type: "ENTRY",
          quantity: it.balance,
          reason: "contract_created",
        });
      }

      return tx.contract.findUnique({
        where: { id: created.id },
        include: {
          items: { include: { product: { select: { id: true, name: true, sku: true } } } },
          company: { select: { id: true, name: true } },
          contact: { select: { id: true, name: true } },
          deal: { select: { id: true, title: true } },
          owner: { select: { id: true, name: true } },
          priceTable: { select: { id: true, name: true } },
        },
      });
    });

    if (contract) {
      fireTrigger("contract_created", {
        dealId: contract.dealId ?? undefined,
        data: {
          organizationId,
          contractId: contract.id,
          dealId: contract.dealId,
          companyId: contract.companyId,
          contactId: contract.contactId,
          itemCount: contract.items.length,
          userId,
        },
      }).catch(() => {});
    }

    return NextResponse.json({ contract }, { status: 201 });
  });
}
