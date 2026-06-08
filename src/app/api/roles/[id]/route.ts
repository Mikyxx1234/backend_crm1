import { NextResponse } from "next/server";

import { requireCan } from "@/lib/auth-helpers";
import { invalidateAuthzForOrg } from "@/lib/authz";
import { isValidPermissionKey, sanitizePermissions } from "@/lib/authz/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const r = await requireCan("settings:roles");
  if (!r.ok) return r.response;
  const { ctx } = r;
  if (!ctx.organizationId) {
    return NextResponse.json({ message: "Contexto de organização inválido." }, { status: 400 });
  }

  const role = await prisma.role.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      assignments: {
        include: {
          user: { select: { id: true, name: true, email: true, avatarUrl: true } },
        },
      },
      _count: { select: { assignments: true, groups: true, groupMembers: true } },
    },
  });

  if (!role) {
    return NextResponse.json({ message: "Role não encontrado." }, { status: 404 });
  }

  return NextResponse.json(role);
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const r = await requireCan("settings:roles");
  if (!r.ok) return r.response;
  const { ctx } = r;
  if (!ctx.organizationId) {
    return NextResponse.json({ message: "Contexto de organização inválido." }, { status: 400 });
  }

  const role = await prisma.role.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!role) {
    return NextResponse.json({ message: "Role não encontrado." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  if (!role.isSystem) {
    if (typeof b.name === "string") {
      const name = b.name.trim();
      if (!name) {
        return NextResponse.json({ message: "Nome não pode ser vazio." }, { status: 400 });
      }
      const conflict = await prisma.role.findFirst({
        where: { organizationId: ctx.organizationId, name, NOT: { id } },
      });
      if (conflict) {
        return NextResponse.json(
          { message: `Já existe um role com o nome "${name}".` },
          { status: 409 },
        );
      }
      data.name = name;
    }
    if (b.description !== undefined) {
      data.description =
        typeof b.description === "string" ? b.description.trim() || null : null;
    }
  }

  if (b.permissions !== undefined) {
    const rawPermissions = Array.isArray(b.permissions) ? (b.permissions as unknown[]) : [];
    const invalid = rawPermissions.filter(
      (p) => typeof p !== "string" || !isValidPermissionKey(p),
    );
    if (invalid.length > 0) {
      return NextResponse.json(
        { message: `Chaves inválidas: ${invalid.join(", ")}` },
        { status: 400 },
      );
    }
    data.permissions = sanitizePermissions(rawPermissions as string[]);
  }

  const updated = await prisma.role.update({
    where: { id },
    data,
  });

  await invalidateAuthzForOrg(ctx.organizationId);

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const r = await requireCan("settings:roles");
  if (!r.ok) return r.response;
  const { ctx } = r;
  if (!ctx.organizationId) {
    return NextResponse.json({ message: "Contexto de organização inválido." }, { status: 400 });
  }

  const role = await prisma.role.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!role) {
    return NextResponse.json({ message: "Role não encontrado." }, { status: 404 });
  }
  if (role.isSystem) {
    return NextResponse.json(
      { message: "Roles de sistema não podem ser deletados." },
      { status: 409 },
    );
  }

  const [assignmentCount, groupCount, groupMemberCount] = await Promise.all([
    prisma.userRoleAssignment.count({ where: { roleId: id } }),
    prisma.userGroup.count({ where: { roleId: id } }),
    prisma.userGroupMember.count({ where: { roleId: id } }),
  ]);

  if (assignmentCount > 0 || groupCount > 0 || groupMemberCount > 0) {
    return NextResponse.json(
      {
        message:
          "Role em uso. Remova atribuições de usuários e overrides de membros de grupo antes de deletar.",
      },
      { status: 409 },
    );
  }

  await prisma.role.delete({ where: { id } });
  await invalidateAuthzForOrg(ctx.organizationId);

  return NextResponse.json({ ok: true });
}
