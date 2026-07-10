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
  icon: z.string().min(1).max(10).default("🏢"),
});

export async function GET() {
  return withOrgContext(async (session) => {
    const role = session.user.role;
    if (role !== "ADMIN" && role !== "MANAGER") {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
    }
    try {
      const departments = await prisma.department.findMany({
        where: { organizationId: session.user.organizationId! },
        include: {
          _count: { select: { conversations: { where: { status: "OPEN" } } } },
        },
        orderBy: { name: "asc" },
      });
      return NextResponse.json(departments);
    } catch {
      // Table doesn't exist yet (migration pending) — return empty list.
      return NextResponse.json([]);
    }
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
    try {
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
          after: { name: department.name, color: department.color, icon: department.icon },
        },
      });
      return NextResponse.json(department, { status: 201 });
    } catch (err) {
      console.error("[POST /settings/departments]", err);
      const message =
        err instanceof Error && err.message.includes("does not exist")
          ? "A tabela de departamentos ainda não existe. Aguarde a migração ser aplicada."
          : "Erro ao criar departamento. Tente novamente.";
      return NextResponse.json({ message }, { status: 503 });
    }
  });
}
