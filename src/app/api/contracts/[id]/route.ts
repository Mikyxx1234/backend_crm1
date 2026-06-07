/**
 * GET    /api/contracts/[id]   — detalhe completo (items, movements recentes)
 * PUT    /api/contracts/[id]   — edita campos básicos (status, datas, notes)
 * DELETE /api/contracts/[id]   — cancela contrato (status=CANCELLED + CANCELLATION
 *                                em cada item com `reserved` > 0)
 *
 * Permissões:
 *   - GET: product:view
 *   - PUT/DELETE: product:manage
 *
 * NÃO remove fisicamente o contrato — preserva histórico (audit). Para
 * "remover" use status=CANCELLED ou COMPLETED via PUT.
 */

import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/request-context";
import { fireTrigger } from "@/services/automation-triggers";
import { recordStockMovement } from "@/services/stock";

type RouteParams = { params: Promise<{ id: string }> };

const VALID_STATUSES = new Set(["ACTIVE", "SUSPENDED", "CANCELLED", "COMPLETED"]);

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
      include: {
        items: {
          include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
          orderBy: { createdAt: "asc" },
        },
        movements: {
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { product: { select: { id: true, name: true } } },
        },
        company: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true, status: true } },
        owner: { select: { id: true, name: true } },
        priceTable: { select: { id: true, name: true } },
      },
    });
    if (!contract) {
      return NextResponse.json({ message: "Contrato não encontrado." }, { status: 404 });
    }
    return NextResponse.json({ contract });
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

    const existing = await prisma.contract.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ message: "Contrato não encontrado." }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (typeof body.status === "string") {
      if (!VALID_STATUSES.has(body.status)) {
        return NextResponse.json(
          { message: `status inválido. Use: ${Array.from(VALID_STATUSES).join(", ")}.` },
          { status: 400 },
        );
      }
      data.status = body.status;
    }
    if (typeof body.code === "string") data.code = body.code.trim() || null;
    if (typeof body.notes === "string") data.notes = body.notes.trim() || null;
    if (body.startDate !== undefined) {
      data.startDate = body.startDate ? new Date(body.startDate as string) : null;
    }
    if (body.endDate !== undefined) {
      data.endDate = body.endDate ? new Date(body.endDate as string) : null;
    }
    if (typeof body.ownerId === "string" || body.ownerId === null) {
      data.ownerId = body.ownerId || null;
    }

    const prevStatus = (await prisma.contract.findUnique({
      where: { id },
      select: { status: true },
    }))?.status;

    const contract = await prisma.contract.update({
      where: { id },
      data,
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        company: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
        owner: { select: { id: true, name: true } },
      },
    });

    const closedNow =
      (contract.status === "COMPLETED" || contract.status === "CANCELLED") &&
      prevStatus !== contract.status;
    if (closedNow) {
      fireTrigger("contract_closed", {
        dealId: contract.dealId ?? undefined,
        data: {
          organizationId: session.user.organizationId,
          contractId: contract.id,
          dealId: contract.dealId,
          status: contract.status,
          userId: session.user.id,
        },
      }).catch(() => {});
    }

    return NextResponse.json({ contract });
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

    const existing = await prisma.contract.findUnique({
      where: { id },
      include: { items: { select: { id: true, productId: true, reserved: true } } },
    });
    if (!existing) {
      return NextResponse.json({ message: "Contrato não encontrado." }, { status: 404 });
    }
    if (existing.status === "CANCELLED") {
      return NextResponse.json({ message: "Contrato já cancelado." }, { status: 409 });
    }

    const reqCtx = getRequestContext();
    const userId = reqCtx?.userId ?? null;
    const organizationId = session.user.organizationId;
    if (!organizationId) {
      return NextResponse.json({ message: "organização não resolvida." }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      for (const item of existing.items) {
        const reservedQty = Number(item.reserved);
        if (reservedQty > 0) {
          await recordStockMovement(tx, {
            organizationId,
            productId: item.productId,
            contractItemId: item.id,
            userId,
            type: "CANCELLATION",
            quantity: reservedQty,
            reason: "contract_cancelled",
          });
        }
      }
      await tx.contract.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
    });

    fireTrigger("contract_closed", {
      dealId: existing.dealId ?? undefined,
      data: {
        organizationId,
        contractId: existing.id,
        dealId: existing.dealId,
        status: "CANCELLED",
        userId,
      },
    }).catch(() => {});

    return NextResponse.json({ ok: true, cancelled: true });
  });
}
