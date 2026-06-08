import { NextResponse } from "next/server";

import { requireCan } from "@/lib/auth-helpers";
import { invalidateAuthzForUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const r = await requireCan("group:view");
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

  const members = await prisma.userGroupMember.findMany({
    where: { groupId: id },
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      role: { select: { id: true, name: true, systemPreset: true } },
    },
    orderBy: { joinedAt: "asc" },
  });

  return NextResponse.json(members);
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const userId = typeof b.userId === "string" ? b.userId.trim() : "";
  if (!userId) {
    return NextResponse.json({ message: "userId é obrigatório." }, { status: 400 });
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: ctx.organizationId },
  });
  if (!user) {
    return NextResponse.json(
      { message: "Usuário não encontrado nesta organização." },
      { status: 404 },
    );
  }

  const roleId = typeof b.roleId === "string" ? b.roleId : null;
  if (roleId) {
    const role = await prisma.role.findFirst({
      where: { id: roleId, organizationId: ctx.organizationId },
    });
    if (!role) {
      return NextResponse.json(
        { message: "Role de override não encontrado nesta organização." },
        { status: 404 },
      );
    }
  }

  const existing = await prisma.userGroupMember.findFirst({
    where: { groupId: id, userId },
  });
  if (existing) {
    return NextResponse.json(
      { message: "Usuário já é membro deste grupo." },
      { status: 409 },
    );
  }

  const member = await prisma.userGroupMember.create({
    data: { groupId: id, userId, roleId },
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      role: { select: { id: true, name: true, systemPreset: true } },
    },
  });

  await invalidateAuthzForUser(userId);

  return NextResponse.json(member, { status: 201 });
}
