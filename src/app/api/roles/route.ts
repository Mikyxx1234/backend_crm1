import { NextResponse } from "next/server";

import { requireCan } from "@/lib/auth-helpers";
import { invalidateAuthzForOrg } from "@/lib/authz";
import { isValidPermissionKey, sanitizePermissions } from "@/lib/authz/permissions";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const r = await requireCan("settings:roles");
  if (!r.ok) return r.response;
  const { ctx } = r;
  if (!ctx.organizationId) {
    return NextResponse.json({ message: "Contexto de organização inválido." }, { status: 400 });
  }

  const roles = await prisma.role.findMany({
    where: { organizationId: ctx.organizationId },
    include: {
      _count: { select: { assignments: true, groups: true, groupMembers: true } },
    },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });

  return NextResponse.json(roles);
}

export async function POST(request: Request) {
  const r = await requireCan("settings:roles");
  if (!r.ok) return r.response;
  const { ctx } = r;
  if (!ctx.organizationId) {
    return NextResponse.json({ message: "Contexto de organização inválido." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const description =
    typeof b.description === "string" ? b.description.trim() || null : null;
  const rawPermissions = Array.isArray(b.permissions) ? (b.permissions as unknown[]) : [];

  if (!name) {
    return NextResponse.json({ message: "Nome é obrigatório." }, { status: 400 });
  }

  const invalid = rawPermissions.filter(
    (p) => typeof p !== "string" || !isValidPermissionKey(p),
  );
  if (invalid.length > 0) {
    return NextResponse.json(
      { message: `Chaves inválidas: ${invalid.join(", ")}` },
      { status: 400 },
    );
  }

  const existing = await prisma.role.findFirst({
    where: { organizationId: ctx.organizationId, name },
  });
  if (existing) {
    return NextResponse.json(
      { message: `Já existe um role com o nome "${name}".` },
      { status: 409 },
    );
  }

  const role = await prisma.role.create({
    data: {
      organizationId: ctx.organizationId,
      name,
      description,
      permissions: sanitizePermissions(rawPermissions as string[]),
      isSystem: false,
      systemPreset: null,
    },
  });

  await invalidateAuthzForOrg(ctx.organizationId);

  return NextResponse.json(role, { status: 201 });
}
