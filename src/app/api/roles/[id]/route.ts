import { NextResponse } from "next/server";
import { z } from "zod";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { deleteRole, getRoleById, updateRole } from "@/services/roles";

type RouteContext = { params: Promise<{ id: string }> };

const updateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(500).nullable().optional(),
    permissions: z.array(z.string()).optional(),
    inheritsFrom: z.string().min(1).nullable().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "Nenhum campo para atualizar.",
  });

export async function GET(_request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    const ctx = await loadAuthzContext({
      userId: session.user.id,
      organizationId: session.user.organizationId,
      isSuperAdmin: session.user.isSuperAdmin,
    });
    if (!can(ctx, "settings:permissions")) {
      return NextResponse.json(
        { message: "Acesso negado.", required: "settings:permissions" },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    try {
      const role = await getRoleById(id);
      if (!role) {
        return NextResponse.json({ message: "Role não encontrado." }, { status: 404 });
      }
      return NextResponse.json(role);
    } catch (e) {
      console.error("[GET /api/roles/[id]]", e);
      return NextResponse.json(
        { message: "Erro ao buscar role." },
        { status: 500 },
      );
    }
  });
}

export async function PUT(request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    const ctx = await loadAuthzContext({
      userId: session.user.id,
      organizationId: session.user.organizationId,
      isSuperAdmin: session.user.isSuperAdmin,
    });
    if (!can(ctx, "settings:permissions")) {
      return NextResponse.json(
        { message: "Acesso negado.", required: "settings:permissions" },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const parsed = updateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Dados inválidos.", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    try {
      const role = await updateRole(id, parsed.data);
      if (!role) {
        return NextResponse.json({ message: "Role não encontrado." }, { status: 404 });
      }
      return NextResponse.json(role);
    } catch (e) {
      console.error("[PUT /api/roles/[id]]", e);
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro ao atualizar role." },
        { status: 400 },
      );
    }
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    const ctx = await loadAuthzContext({
      userId: session.user.id,
      organizationId: session.user.organizationId,
      isSuperAdmin: session.user.isSuperAdmin,
    });
    if (!can(ctx, "settings:permissions")) {
      return NextResponse.json(
        { message: "Acesso negado.", required: "settings:permissions" },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    try {
      const result = await deleteRole(id);
      if (!result) {
        return NextResponse.json({ message: "Role não encontrado." }, { status: 404 });
      }
      return NextResponse.json(result);
    } catch (e) {
      console.error("[DELETE /api/roles/[id]]", e);
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro ao excluir role." },
        { status: 400 },
      );
    }
  });
}
