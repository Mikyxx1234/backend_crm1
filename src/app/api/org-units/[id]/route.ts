import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "org_unit:view");
    if (denied) return denied;

    const { id } = await context.params;
    const orgUnit = await prisma.orgUnit.findUnique({ where: { id } });
    if (!orgUnit) {
      return NextResponse.json({ message: "Unidade não encontrada." }, { status: 404 });
    }
    return NextResponse.json({ orgUnit });
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "org_unit:manage");
    if (denied) return denied;

    const { id } = await context.params;
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
    if (typeof body.legalName === "string") data.legalName = body.legalName.trim() || null;
    if (typeof body.taxId === "string") data.taxId = body.taxId.trim() || null;
    if (typeof body.address === "string") data.address = body.address.trim() || null;
    if (typeof body.active === "boolean") data.active = body.active;
    if (body.parentId === null || typeof body.parentId === "string") {
      data.parentId = body.parentId || null;
    }

    try {
      const orgUnit = await prisma.orgUnit.update({ where: { id }, data });
      return NextResponse.json({ orgUnit });
    } catch {
      return NextResponse.json({ message: "Unidade não encontrada." }, { status: 404 });
    }
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "org_unit:manage");
    if (denied) return denied;

    const { id } = await context.params;
    try {
      await prisma.orgUnit.update({ where: { id }, data: { active: false } });
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ message: "Unidade não encontrada." }, { status: 404 });
    }
  });
}
