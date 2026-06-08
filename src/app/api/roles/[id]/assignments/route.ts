import { NextResponse } from "next/server";

import { requireCan } from "@/lib/auth-helpers";
import { invalidateAuthzForUser } from "@/lib/authz";
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
  });
  if (!role) {
    return NextResponse.json({ message: "Role não encontrado." }, { status: 404 });
  }

  const assignments = await prisma.userRoleAssignment.findMany({
    where: { roleId: id, organizationId: ctx.organizationId },
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(assignments);
}

export async function POST(request: Request, { params }: Params) {
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

  const assignment = await prisma.userRoleAssignment.upsert({
    where: { userId_roleId: { userId, roleId: id } },
    create: {
      userId,
      roleId: id,
      organizationId: ctx.organizationId,
      assignedById: ctx.userId,
    },
    update: {},
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      role: { select: { id: true, name: true, systemPreset: true } },
    },
  });

  await invalidateAuthzForUser(userId);

  return NextResponse.json(assignment, { status: 201 });
}
