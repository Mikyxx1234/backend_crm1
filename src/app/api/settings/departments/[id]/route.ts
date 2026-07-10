import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const UpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withOrgContext(async (session) => {
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
    }
    const { id } = await params;
    const dept = await prisma.department.findFirst({
      where: { id, organizationId: session.user.organizationId! },
    });
    if (!dept)
      return NextResponse.json(
        { message: "Departamento não encontrado." },
        { status: 404 },
      );

    const body = await request.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: "Dados inválidos." }, { status: 400 });
    }
    const updated = await prisma.department.update({
      where: { id },
      data: parsed.data,
    });
    await prisma.auditLog.create({
      data: {
        organizationId: session.user.organizationId,
        actorId: session.user.id,
        actorEmail: session.user.email,
        entity: "Department",
        entityId: updated.id,
        action: "update",
        before: { name: dept.name, color: dept.color },
        after: { name: updated.name, color: updated.color },
      },
    });
    return NextResponse.json(updated);
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withOrgContext(async (session) => {
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
    }
    const { id } = await params;
    const dept = await prisma.department.findFirst({
      where: { id, organizationId: session.user.organizationId! },
      include: {
        _count: { select: { conversations: { where: { status: "OPEN" } } } },
      },
    });
    if (!dept)
      return NextResponse.json(
        { message: "Departamento não encontrado." },
        { status: 404 },
      );

    if (dept._count.conversations > 0) {
      return NextResponse.json(
        {
          message: `Este departamento possui ${dept._count.conversations} conversa(s) ativa(s). Reatribua-as antes de excluir.`,
          code: "HAS_ACTIVE_CONVERSATIONS",
        },
        { status: 409 },
      );
    }

    await prisma.department.delete({ where: { id } });

    // Clean up stale allowedDepartmentIds references in AgentPermission.
    // Cannot use FK here because allowedDepartmentIds is a String[] array.
    await prisma.$executeRaw`
      UPDATE agent_permissions
      SET "allowedDepartmentIds" = array_remove("allowedDepartmentIds", ${dept.id})
      WHERE ${dept.id} = ANY("allowedDepartmentIds")
        AND "organizationId" = ${session.user.organizationId}
    `;

    await prisma.auditLog.create({
      data: {
        organizationId: session.user.organizationId,
        actorId: session.user.id,
        actorEmail: session.user.email,
        entity: "Department",
        entityId: dept.id,
        action: "delete",
        before: { name: dept.name, color: dept.color },
      },
    });
    return NextResponse.json({ ok: true });
  });
}
