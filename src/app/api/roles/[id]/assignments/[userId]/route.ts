import { NextResponse } from "next/server";

import { requireCan } from "@/lib/auth-helpers";
import { invalidateAuthzForUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string; userId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const { id, userId } = await params;
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

  const assignment = await prisma.userRoleAssignment.findFirst({
    where: { roleId: id, userId, organizationId: ctx.organizationId },
  });
  if (!assignment) {
    return NextResponse.json({ message: "Atribuição não encontrada." }, { status: 404 });
  }

  // Não pode remover o último ADMIN da org
  if (role.systemPreset === "ADMIN") {
    const adminCount = await prisma.userRoleAssignment.count({
      where: {
        organizationId: ctx.organizationId,
        role: { systemPreset: "ADMIN" },
        NOT: { userId },
      },
    });
    if (adminCount === 0) {
      return NextResponse.json(
        { message: "É necessário manter ao menos um administrador na organização." },
        { status: 409 },
      );
    }
  }

  await prisma.userRoleAssignment.delete({
    where: { userId_roleId: { userId, roleId: id } },
  });

  await invalidateAuthzForUser(userId);

  return NextResponse.json({ ok: true });
}
