import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { z } from "zod";

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#6366f1"),
});

export async function GET() {
  return withOrgContext(async (session) => {
    const role = session.user.role;
    if (role !== "ADMIN" && role !== "MANAGER") {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
    }
    const departments = await prisma.department.findMany({
      where: { organizationId: session.user.organizationId! },
      include: {
        _count: { select: { conversations: { where: { status: "OPEN" } } } },
      },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(departments);
  });
}

export async function POST(request: Request) {
  return withOrgContext(async (session) => {
    const role = session.user.role;
    if (role !== "ADMIN") {
      return NextResponse.json(
        { message: "Apenas administradores podem criar departamentos." },
        { status: 403 },
      );
    }
    const body = await request.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Dados inválidos.", errors: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const department = await prisma.department.create({
      data: withOrgFromCtx({ ...parsed.data }),
    });
    await prisma.auditLog.create({
      data: {
        organizationId: session.user.organizationId,
        actorId: session.user.id,
        actorEmail: session.user.email,
        entity: "Department",
        entityId: department.id,
        action: "create",
        after: { name: department.name, color: department.color },
      },
    });
    return NextResponse.json(department, { status: 201 });
  });
}
