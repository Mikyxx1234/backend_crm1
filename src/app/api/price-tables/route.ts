/**
 * GET  /api/price-tables       — lista tabelas da organização
 * POST /api/price-tables       — cria nova tabela
 *
 * Permissões:
 *   - GET  exige `product:view`
 *   - POST exige `product:manage`
 *
 * Regra de negócio: ao marcar `isDefault=true` no POST, qualquer outra
 * PriceTable da org com `isDefault=true` é rebaixada para `false` na
 * mesma transação (apenas uma tabela default por org).
 */

import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

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
    const activeOnly = url.searchParams.get("active") !== "false";
    const search = url.searchParams.get("search")?.trim() ?? "";

    const where: Record<string, unknown> = {};
    if (activeOnly) where.isActive = true;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const priceTables = await prisma.priceTable.findMany({
      where,
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      include: { _count: { select: { items: true, contracts: true } } },
    });

    return NextResponse.json({ priceTables });
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

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ message: "Nome é obrigatório." }, { status: 400 });
    }

    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
    const isDefault = body.isDefault === true;
    const isActive = body.isActive !== false;

    const priceTable = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.priceTable.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.priceTable.create({
        data: withOrgFromCtx({
          name,
          description,
          isDefault,
          isActive,
        }),
      });
    });

    return NextResponse.json({ priceTable }, { status: 201 });
  });
}
