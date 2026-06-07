/**
 * GET    /api/price-tables/[id]   — detalhe + itens + contratos vinculados
 * PUT    /api/price-tables/[id]   — editar campos básicos
 * DELETE /api/price-tables/[id]   — remover (rejeita se houver Contract ATIVO)
 *
 * Permissões:
 *   - GET exige `product:view`
 *   - PUT/DELETE exigem `product:manage`
 *
 * Regras:
 *   - DELETE só permitido se nenhum Contract vinculado estiver com status ACTIVE
 *     ou SUSPENDED (CANCELLED/COMPLETED são histórico e não bloqueiam).
 *   - `isDefault=true` em PUT rebaixa as demais (mesmo padrão do POST raiz).
 */

import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

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

    const priceTable = await prisma.priceTable.findUnique({
      where: { id },
      include: {
        items: {
          include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
          orderBy: { createdAt: "asc" },
        },
        _count: { select: { contracts: true } },
      },
    });

    if (!priceTable) {
      return NextResponse.json({ message: "Tabela não encontrada." }, { status: 404 });
    }
    return NextResponse.json({ priceTable });
  });
}

export async function PUT(request: Request, { params }: RouteParams) {
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

    const existing = await prisma.priceTable.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ message: "Tabela não encontrada." }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
    if (typeof body.description === "string") {
      data.description = body.description.trim() || null;
    } else if (body.description === null) {
      data.description = null;
    }
    if (typeof body.isActive === "boolean") data.isActive = body.isActive;
    const setDefault = body.isDefault === true;

    const priceTable = await prisma.$transaction(async (tx) => {
      if (setDefault) {
        await tx.priceTable.updateMany({
          where: { isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
        data.isDefault = true;
      } else if (body.isDefault === false) {
        data.isDefault = false;
      }
      return tx.priceTable.update({ where: { id }, data });
    });

    return NextResponse.json({ priceTable });
  });
}

export async function DELETE(_req: Request, { params }: RouteParams) {
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

    const existing = await prisma.priceTable.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ message: "Tabela não encontrada." }, { status: 404 });
    }

    const activeContracts = await prisma.contract.count({
      where: { priceTableId: id, status: { in: ["ACTIVE", "SUSPENDED"] } },
    });
    if (activeContracts > 0) {
      return NextResponse.json(
        {
          message: "Não é possível remover: existem contratos ativos vinculados a esta tabela.",
          code: "PRICE_TABLE_HAS_ACTIVE_CONTRACTS",
          activeContracts,
        },
        { status: 409 },
      );
    }

    await prisma.priceTable.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
