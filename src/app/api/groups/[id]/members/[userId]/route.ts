import { NextResponse } from "next/server";

import { requireCan } from "@/lib/auth-helpers";
import { invalidateAuthzForUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string; userId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id, userId } = await params;
  const r = await requireCan("group:manage");
  if (!r.ok) return r.response;
  const { ctx } = r;
  if (!ctx.organizationId) {
    return NextResponse.json({ message: "Contexto de organização inválido." }, { status: 400 });
  }

  const group = await prisma.userGroup.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!group) {
    return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
  }

  const member = await prisma.userGroupMember.findFirst({
    where: { groupId: id, userId },
  });
  if (!member) {
    return NextResponse.json({ message: "Membro não encontrado no grupo." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const roleId = b.roleId === null ? null : typeof b.roleId === "string" ? b.roleId : undefined;

  if (roleId !== undefined && roleId !== null) {
    const role = await prisma.role.findFirst({
      where: { id: roleId, organizationId: ctx.organizationId },
    });
    if (!role) {
      return NextResponse.json(
        { message: "Role não encontrado nesta organização." },
        { status: 404 },
      );
    }
  }

  const updated = await prisma.userGroupMember.update({
    where: { groupId_userId: { groupId: id, userId } },
    data: { roleId: roleId ?? null },
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      role: { select: { id: true, name: true, systemPreset: true } },
    },
  });

  await invalidateAuthzForUser(userId);

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id, userId } = await params;
  const r = await requireCan("group:manage");
  if (!r.ok) return r.response;
  const { ctx } = r;
  if (!ctx.organizationId) {
    return NextResponse.json({ message: "Contexto de organização inválido." }, { status: 400 });
  }

  const group = await prisma.userGroup.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!group) {
    return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
  }

  const member = await prisma.userGroupMember.findFirst({
    where: { groupId: id, userId },
  });
  if (!member) {
    return NextResponse.json({ message: "Membro não encontrado no grupo." }, { status: 404 });
  }

  await prisma.userGroupMember.delete({
    where: { groupId_userId: { groupId: id, userId } },
  });

  await invalidateAuthzForUser(userId);

  return NextResponse.json({ ok: true });
}
