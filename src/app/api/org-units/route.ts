import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

export async function GET(request: Request) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "org_unit:view");
    if (denied) return denied;

    const url = new URL(request.url);
    const activeOnly = url.searchParams.get("active") !== "false";
    const orgUnits = await prisma.orgUnit.findMany({
      where: activeOnly ? { active: true } : {},
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        legalName: true,
        taxId: true,
        address: true,
        active: true,
        parentId: true,
      },
    });
    return NextResponse.json({ orgUnits });
  });
}

export async function POST(request: Request) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "org_unit:manage");
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

    const orgUnit = await prisma.orgUnit.create({
      data: withOrgFromCtx({
        name,
        legalName: typeof body.legalName === "string" ? body.legalName.trim() || null : null,
        taxId: typeof body.taxId === "string" ? body.taxId.trim() || null : null,
        address: typeof body.address === "string" ? body.address.trim() || null : null,
        parentId: typeof body.parentId === "string" && body.parentId ? body.parentId : null,
        active: body.active !== false,
      }),
    });
    return NextResponse.json({ orgUnit }, { status: 201 });
  });
}
